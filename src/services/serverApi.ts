import type { Assignment } from '../data/mockData';
import type { CalendarEvent, SchoolClass, Quiz, ClassMaterial } from '../db/database';
import { configureDataProtection } from './dataProtection';
import {saveSession} from './sessionStorage';
import {cacheValue, cachedValue, queueMutation, accountScope, accountStorageName} from '../db/database';
import * as FileSystem from 'expo-file-system/legacy';
import {Platform} from 'react-native';

export type ServerSnapshot = {
  assignments: Assignment[];
  classes: SchoolClass[];
  events: CalendarEvent[];
  quizzes?: Quiz[];
  materials?: ClassMaterial[];
};

export type UserRole = 'student' | 'teacher' | 'administrator';

export type Session = {
  token: string;
  user: { id: string; username: string; displayName: string; role: UserRole };
};

export type ServerUser = Session['user'] & { active: boolean; createdAt?: string };

export type ServerHealth = {
  status: 'ok' | 'degraded';
  version?: string;
  storage?: { usedBytes: number; freeBytes: number; totalBytes: number };
  database?: string;
  checkedAt?: string;
};

export type TeacherSubmission = {
  id: string;
  assignmentId: string;
  studentId: string;
  studentName: string;
  submittedAt: string;
  status: 'submitted' | 'returned' | 'revision_requested' | 'graded';
  gradeValue: number | null;
  gradeLabel: string | null;
  feedback: string[];
  files: { id: string; name: string; mimeType: string; uri?: string }[];
};

export type AdminOverview = {
  users: ServerUser[];
  classes: SchoolClass[];
  health: ServerHealth;
  pendingBackups: { id: string; createdAt: string; sizeBytes?: number; status: string }[];
};

export type SyncOperation = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

// Use the hostname that is known to resolve in the browser.  The bare
// `photobooth` name is not resolvable by every Expo web environment.
export const DEFAULT_RASPBERRY_PI_URL = 'http://photobooth.local:9000';
export const DEFAULT_RASPBERRY_PI_URLS = [
  'http://photobooth.local:9000',
  'http://photobooth:9000',
  'http://192.168.4.1:9000',
  // Compatibility with a Pi service that has not been restarted after the port change.
  'http://photobooth:8090',
  'http://photobooth.local:8090',
  'http://192.168.4.1:8090',
];

let activeServerToken: string | null = null;
let activeServerUrl: string | null = null;

function normalizeServerUrl(value: string) {
  const trimmed = value.replace(/\/$/, '');
  return /^http:\/\/[^/:]+$/.test(trimmed) || /^http:\/\/\[[^\]]+\]$/.test(trimmed)
    ? `${trimmed}:9000`
    : trimmed;
}

export class LocalServerClient {
  fromCache = false;
  downloadError: string | null = null;
  readonly baseUrl: string;
  private token: string | null;
  private scope = accountScope();

  private assertAccount() {
    if (this.scope !== accountScope()) throw Error('Account changed during request');
  }

  constructor(baseUrl = activeServerUrl ?? getConfiguredServerUrl() ?? '', token: string | null = activeServerToken) {
    this.baseUrl = normalizeServerUrl(baseUrl);
    this.token = token;
  }

  setToken(token: string | null) {
    this.token = token;
    activeServerToken = token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    this.assertAccount();
    const scope = accountScope();
    if (!this.baseUrl) throw new Error('No Raspberry Pi server URL is configured.');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response: Response;
    try {response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(init.headers ?? {}),
      },
    });} catch(error) {
      if (scope !== accountScope()) throw Error('Account changed during request');
      if (!init.method || init.method === 'GET') {
        const cached = await cachedValue<T>(path);
        if (cached !== null) {this.fromCache = true; return cached;}
      }
      throw error;
    } finally {clearTimeout(timeout);}

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error(message || `Local server returned ${response.status}.`);
    }

    const result = response.status === 204 ? undefined as T : await response.json() as T;
    this.fromCache = false;
    if (scope !== accountScope()) throw Error('Account changed during request');
    if (!init.method || init.method === 'GET') await cacheValue(path, result);
    return result;
  }

  async mutate<T>(path: string, input: Record<string, unknown>, method = 'POST'): Promise<{queued: boolean; result?: T}> {
    this.assertAccount();
    const body = {...input, id: input.id ?? `client-${Date.now()}-${Math.random().toString(36).slice(2)}`};
    // Save first so closing the app during an upload does not lose the draft.
    await queueMutation(path, method, body);
    return {queued: true};
  }
  replay(path: string, body: Record<string, unknown>, method = 'POST') {return this.request(path, {method, body: JSON.stringify(body)});}

  async login(username: string, password: string) {
    const session = await this.request<Session>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    this.token = session.token;
    activeServerToken = session.token;
    configureDataProtection(`${session.user.id}:${password}`);
    await saveSession(session, this.baseUrl);
    return session;
  }

  async logout() {
    await this.request<void>('/api/auth/logout', { method: 'POST' });
    this.setToken(null);
  }
  health() { return this.request<ServerHealth>('/api/admin/health'); }
  async snapshot() {
    this.downloadError = null;
    const snapshot = await this.request<ServerSnapshot>('/api/snapshot');
    await this.prefetch(snapshot.assignments.flatMap(a => a.resources ?? [])).catch(error => {this.assertAccount(); this.downloadError = String(error);});
    return snapshot;
  }
  async prefetch(files: {id: string; name: string}[]) {
    const scope = accountScope();
    let failure: Error | null = null;
    for (const f of files) {
      if(scope !== accountScope()) return;
      try {if(Platform.OS === 'web') await this.file(f.id); else await this.downloadFile(f.id, f.name);} catch(error) {
        this.assertAccount();
        failure = new Error(`Could not download ${f.name}. Reconnect and sync again. ${String(error)}`);
      }
    }
    if (failure) throw failure;
  }
  createQuiz(input: Record<string, unknown>) { return this.request('/api/quizzes', {method: 'POST', body: JSON.stringify(input)}); }
  createMaterial(input: Record<string, unknown>) { return this.request('/api/materials', {method: 'POST', body: JSON.stringify(input)}); }
  quizReviews(id: string) { return this.request<{id: string; studentName: string; answers: Record<string, string>; status: string; score: number | null}[]>(`/api/quizzes/${id}/attempts`); }
  gradeQuiz(id: string, score: number) { return this.request(`/api/quiz-attempts/${id}/grade`, {method: 'POST', body: JSON.stringify({score})}); }
  attemptQuiz(quizId: string, answers: Record<string, string>) { return this.request<{id: string; score: number | null; status: string}>('/api/quiz-attempts', {method: 'POST', body: JSON.stringify({quizId, answers})}); }
  upload(form: FormData) { return this.request<{id: string; storageKey: string}>('/api/files/upload', {method: 'POST', body: form}); }
  submit(input: Record<string, unknown>) { return this.request<{id: string}>('/api/submissions', {method: 'POST', body: JSON.stringify(input)}); }
  attach(id: string, file: Record<string, unknown>) { return this.request(`/api/submissions/${id}/files`, {method: 'POST', body: JSON.stringify(file)}); }
  async file(id: string) {
    this.assertAccount();
    const scope = accountScope();
    const saved = await cachedValue<string>(`file:${id}`);
    if (saved) return (await fetch(saved)).blob();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let blob: Blob;
    try {
      const response = await fetch(`${this.baseUrl}/api/files/${id}`, {signal: controller.signal, headers: {Authorization: `Bearer ${this.token}`}});
      if (!response.ok) throw new Error(`File access failed (${response.status})`);
      blob = await response.blob();
      this.assertAccount();
    } finally {clearTimeout(timer);}
    if (typeof FileReader !== 'undefined') {
      const value = await new Promise<string>((resolve, reject) => {const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);});
      if(scope === accountScope()) await cacheValue(`file:${id}`, value);
    }
    return blob;
  }
  async downloadFile(id: string, name: string) {
    this.assertAccount();
    const directory = `${FileSystem.documentDirectory}classroom-files/${accountStorageName()}/`;
    await FileSystem.makeDirectoryAsync(directory, {intermediates: true});
    const uri = `${directory}${id}-${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    if ((await FileSystem.getInfoAsync(uri)).exists) return Platform.OS === 'android' ? FileSystem.getContentUriAsync(uri) : uri;
    const temporaryUri = `${uri}.${Date.now()}-${Math.random().toString(36).slice(2)}.part`;
    try {
      const result = await FileSystem.downloadAsync(`${this.baseUrl}/api/files/${id}`, temporaryUri, {headers: {Authorization: `Bearer ${this.token}`}});
      this.assertAccount();
      if (result.status !== 200) throw new Error('File download failed');
      await FileSystem.moveAsync({from: temporaryUri, to: uri});
    } catch(error) {
      await FileSystem.deleteAsync(temporaryUri, {idempotent: true});
      throw error;
    }
    return Platform.OS === 'android' ? FileSystem.getContentUriAsync(uri) : uri;
  }
  adminOverview() { return this.request<AdminOverview>('/api/admin/overview'); }

  createUser(input: { username: string; displayName: string; password: string; role: UserRole }) {
    return this.request<ServerUser>('/api/admin/users', { method: 'POST', body: JSON.stringify(input) });
  }

  updateUser(id: string, input: Partial<{ displayName: string; password: string; role: UserRole; active: boolean }>) {
    return this.request<ServerUser>(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
  }

  deleteUser(id: string) { return this.request<void>(`/api/admin/users/${id}`, { method: 'DELETE' }); }
  createClass(input: Record<string, unknown>) { return this.request<SchoolClass>('/api/classes', { method: 'POST', body: JSON.stringify(input) }); }
  updateClass(id: string, input: Record<string, unknown>) { return this.request<SchoolClass>(`/api/classes/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); }
  enroll(classId: string, userId: string) { return this.request<void>(`/api/classes/${classId}/members`, { method: 'POST', body: JSON.stringify({ userId }) }); }
  enrollByUsername(classId: string, username: string) {return this.request<void>(`/api/classes/${classId}/members`, {method: 'POST', body: JSON.stringify({username})});}
  roster(classId: string) {return this.request<{id: string; username: string; displayName: string; active: boolean}[]>(`/api/classes/${classId}/members`);}
  removeEnrollment(classId: string, userId: string) { return this.request<void>(`/api/classes/${classId}/members/${userId}`, { method: 'DELETE' }); }
  createAssignment(input: Record<string, unknown>) { return this.request<Assignment>('/api/assignments', { method: 'POST', body: JSON.stringify(input) }); }
  updateAssignment(id: string, input: Record<string, unknown>) { return this.request<Assignment>(`/api/assignments/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); }
  async submissions(assignmentId: string) {
    const reviews = await this.request<TeacherSubmission[]>(`/api/assignments/${assignmentId}/submissions`);
    await this.prefetch(reviews.flatMap(r => r.files)).catch(error => {this.assertAccount(); this.downloadError = String(error);});
    return reviews;
  }

  gradeSubmission(id: string, input: { gradeValue?: number; gradeLabel?: string; feedback: string; status: 'graded' | 'returned' | 'revision_requested' }) {
    return this.request<TeacherSubmission>(`/api/submissions/${id}/grade`, { method: 'POST', body: JSON.stringify(input) });
  }

  createEvent(input: Record<string, unknown>) { return this.request<CalendarEvent>('/api/calendar/events', { method: 'POST', body: JSON.stringify(input) }); }
  createBackup() { return this.request<{ id: string; createdAt: string; status: string }>('/api/admin/backups', { method: 'POST' }); }
  restoreBackup(id: string) { return this.request<void>(`/api/admin/backups/${id}/restore`, { method: 'POST' }); }
  sync(operations: SyncOperation[]) { return this.request<{ accepted: string[]; rejected?: { id: string; reason: string }[] }>('/api/sync/operations', { method: 'POST', body: JSON.stringify({ operations }) }); }
}

export function getConfiguredServerUrl() {
  return activeServerUrl ?? (process.env.EXPO_PUBLIC_LMS_SERVER_URL ? normalizeServerUrl(process.env.EXPO_PUBLIC_LMS_SERVER_URL) : webServerOrigin() ?? DEFAULT_RASPBERRY_PI_URL);
}
function webServerOrigin() {
  return Platform.OS === 'web' && process.env.NODE_ENV === 'production' && typeof location !== 'undefined' ? location.origin : null;
}
export function restoreServerConnection(serverUrl: string, token: string) {activeServerUrl = serverUrl; activeServerToken = token;}

export function getConfiguredServerUrls() {
  const configured = process.env.EXPO_PUBLIC_LMS_SERVER_URL ? normalizeServerUrl(process.env.EXPO_PUBLIC_LMS_SERVER_URL) : undefined;
  return configured ? [configured] : [...new Set([webServerOrigin(), ...DEFAULT_RASPBERRY_PI_URLS].filter((url): url is string => !!url))];
}

export function getConfiguredServerCredentials() {
  const username = process.env.EXPO_PUBLIC_LMS_USERNAME;
  const password = process.env.EXPO_PUBLIC_LMS_PASSWORD;
  return username && password ? { username, password } : null;
}

export async function resolveServerUrl() {
  const candidates = getConfiguredServerUrls();
  for (const candidate of candidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800);
    try {
      const response = await fetch(`${candidate}/api/admin/health`, { signal: controller.signal });
      if (response.ok) {
        activeServerUrl = candidate;
        return candidate;
      }
    } catch (_) {
      // Try the next Photobooth hostname/address.
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

export async function fetchServerSnapshot(serverUrl: string): Promise<ServerSnapshot> {
  const response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/snapshot`, {
    headers: activeServerToken ? { Authorization: `Bearer ${activeServerToken}` } : undefined,
  });
  if (!response.ok) throw new Error(`Local server returned ${response.status}.`);
  return response.json() as Promise<ServerSnapshot>;
}
