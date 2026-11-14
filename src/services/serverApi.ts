import type { Assignment } from '../data/mockData';
import type { CalendarEvent, SchoolClass } from '../db/database';

export type ServerSnapshot = { assignments: Assignment[]; classes: SchoolClass[]; events: CalendarEvent[] };

export type UserRole = 'student' | 'teacher' | 'administrator';
export type Session = { token: string; user: { id: string; username: string; displayName: string; role: UserRole } };
export type ServerUser = Session['user'] & { active: boolean; createdAt?: string };
export type ServerHealth = { status: 'ok' | 'degraded'; version?: string; storage?: { usedBytes: number; freeBytes: number; totalBytes: number }; database?: string; checkedAt?: string };
export type TeacherSubmission = { id: string; assignmentId: string; studentId: string; studentName: string; submittedAt: string; status: 'submitted' | 'returned' | 'revision_requested' | 'graded'; gradeValue: number | null; gradeLabel: string | null; feedback: string[]; files: { id: string; name: string; mimeType: string; uri?: string }[] };
export type AdminOverview = { users: ServerUser[]; classes: SchoolClass[]; health: ServerHealth; pendingBackups: { id: string; createdAt: string; sizeBytes?: number; status: string }[] };

export class LocalServerClient {
  readonly baseUrl: string;
  private token: string | null;
  constructor(baseUrl = getConfiguredServerUrl() ?? '', token: string | null = null) { this.baseUrl = baseUrl.replace(/\/$/, ''); this.token = token; }
  setToken(token: string | null) { this.token = token; }
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.baseUrl) throw new Error('No Raspberry Pi server URL is configured.');
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(init.headers ?? {}) } });
    if (!response.ok) { const message = await response.text().catch(() => ''); throw new Error(message || `Local server returned ${response.status}.`); }
    return response.status === 204 ? undefined as T : response.json() as Promise<T>;
  }
  login(username: string, password: string) { return this.request<Session>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }); }
  logout() { return this.request<void>('/api/auth/logout', { method: 'POST' }); }
  health() { return this.request<ServerHealth>('/api/admin/health'); }
  adminOverview() { return this.request<AdminOverview>('/api/admin/overview'); }
  createUser(input: { username: string; displayName: string; password: string; role: UserRole }) { return this.request<ServerUser>('/api/admin/users', { method: 'POST', body: JSON.stringify(input) }); }
  updateUser(id: string, input: Partial<{ displayName: string; password: string; role: UserRole; active: boolean }>) { return this.request<ServerUser>(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); }
  deleteUser(id: string) { return this.request<void>(`/api/admin/users/${id}`, { method: 'DELETE' }); }
  createClass(input: Record<string, unknown>) { return this.request<SchoolClass>('/api/classes', { method: 'POST', body: JSON.stringify(input) }); }
  updateClass(id: string, input: Record<string, unknown>) { return this.request<SchoolClass>(`/api/classes/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); }
  enroll(classId: string, userId: string) { return this.request<void>(`/api/classes/${classId}/members`, { method: 'POST', body: JSON.stringify({ userId }) }); }
  removeEnrollment(classId: string, userId: string) { return this.request<void>(`/api/classes/${classId}/members/${userId}`, { method: 'DELETE' }); }
  createAssignment(input: Record<string, unknown>) { return this.request<Assignment>('/api/assignments', { method: 'POST', body: JSON.stringify(input) }); }
  updateAssignment(id: string, input: Record<string, unknown>) { return this.request<Assignment>(`/api/assignments/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); }
  submissions(assignmentId: string) { return this.request<TeacherSubmission[]>(`/api/assignments/${assignmentId}/submissions`); }
  gradeSubmission(id: string, input: { gradeValue?: number; gradeLabel?: string; feedback: string; status: 'graded' | 'returned' | 'revision_requested' }) { return this.request<TeacherSubmission>(`/api/submissions/${id}/grade`, { method: 'POST', body: JSON.stringify(input) }); }
  createEvent(input: Record<string, unknown>) { return this.request<CalendarEvent>('/api/calendar/events', { method: 'POST', body: JSON.stringify(input) }); }
  createBackup() { return this.request<{ id: string; createdAt: string; status: string }>('/api/admin/backups', { method: 'POST' }); }
  restoreBackup(id: string) { return this.request<void>(`/api/admin/backups/${id}/restore`, { method: 'POST' }); }
}

export function getConfiguredServerUrl() {
  return process.env.EXPO_PUBLIC_LMS_SERVER_URL?.replace(/\/$/, '') ?? null;
}

export async function fetchServerSnapshot(serverUrl: string): Promise<ServerSnapshot> {
  const response = await fetch(`${serverUrl}/api/snapshot`);
  if (!response.ok) throw new Error(`Local server returned ${response.status}.`);
  return response.json() as Promise<ServerSnapshot>;
}
