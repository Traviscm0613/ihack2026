import type { Assignment } from '../data/mockData';
import type { CalendarEvent, SchoolClass } from '../db/database';
import { configureDataProtection } from './dataProtection';

export type ServerSnapshot = {
  assignments: Assignment[];
  classes: SchoolClass[];
  events: CalendarEvent[];
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

export const DEFAULT_RASPBERRY_PI_URL = 'http://photobooth:9000';
export const DEFAULT_RASPBERRY_PI_URLS = [
  'http://photobooth:9000',
  'http://photobooth.local:9000',
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
  return /^https?:\/\/[^/:]+$/.test(trimmed) || /^https?:\/\/\[[^\]]+\]$/.test(trimmed)
    ? `${trimmed}:9000`
    : trimmed;
}

export class LocalServerClient {
  readonly baseUrl: string;
  private token: string | null;

  constructor(baseUrl = activeServerUrl ?? getConfiguredServerUrl() ?? '', token: string | null = activeServerToken) {
    this.baseUrl = normalizeServerUrl(baseUrl);
    this.token = token;
  }

  setToken(token: string | null) {
    this.token = token;
    activeServerToken = token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.baseUrl) throw new Error('No Raspberry Pi server URL is configured.');

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error(message || `Local server returned ${response.status}.`);
    }

    return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
  }

  async login(username: string, password: string) {
    const session = await this.request<Session>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    this.token = session.token;
    activeServerToken = session.token;
    configureDataProtection(session.token);
    return session;
  }

  async logout() {
    await this.request<void>('/api/auth/logout', { method: 'POST' });
    this.setToken(null);
  }
  health() { return this.request<ServerHealth>('/api/admin/health'); }
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
  removeEnrollment(classId: string, userId: string) { return this.request<void>(`/api/classes/${classId}/members/${userId}`, { method: 'DELETE' }); }
  createAssignment(input: Record<string, unknown>) { return this.request<Assignment>('/api/assignments', { method: 'POST', body: JSON.stringify(input) }); }
  updateAssignment(id: string, input: Record<string, unknown>) { return this.request<Assignment>(`/api/assignments/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); }
  submissions(assignmentId: string) { return this.request<TeacherSubmission[]>(`/api/assignments/${assignmentId}/submissions`); }

  gradeSubmission(id: string, input: { gradeValue?: number; gradeLabel?: string; feedback: string; status: 'graded' | 'returned' | 'revision_requested' }) {
    return this.request<TeacherSubmission>(`/api/submissions/${id}/grade`, { method: 'POST', body: JSON.stringify(input) });
  }

  createEvent(input: Record<string, unknown>) { return this.request<CalendarEvent>('/api/calendar/events', { method: 'POST', body: JSON.stringify(input) }); }
  createBackup() { return this.request<{ id: string; createdAt: string; status: string }>('/api/admin/backups', { method: 'POST' }); }
  restoreBackup(id: string) { return this.request<void>(`/api/admin/backups/${id}/restore`, { method: 'POST' }); }
  sync(operations: SyncOperation[]) { return this.request<{ accepted: string[]; rejected?: { id: string; reason: string }[] }>('/api/sync/operations', { method: 'POST', body: JSON.stringify({ operations }) }); }
}

export function getConfiguredServerUrl() {
  return activeServerUrl ?? (process.env.EXPO_PUBLIC_LMS_SERVER_URL ? normalizeServerUrl(process.env.EXPO_PUBLIC_LMS_SERVER_URL) : DEFAULT_RASPBERRY_PI_URL);
}

export function getConfiguredServerUrls() {
  const configured = process.env.EXPO_PUBLIC_LMS_SERVER_URL ? normalizeServerUrl(process.env.EXPO_PUBLIC_LMS_SERVER_URL) : undefined;
  return configured ? [configured] : DEFAULT_RASPBERRY_PI_URLS;
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
  const response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/snapshot`);
  if (!response.ok) throw new Error(`Local server returned ${response.status}.`);
  return response.json() as Promise<ServerSnapshot>;
}
