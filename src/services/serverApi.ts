import type { Assignment } from '../data/mockData';
import type { CalendarEvent, SchoolClass } from '../db/database';

export type ServerSnapshot = { assignments: Assignment[]; classes: SchoolClass[]; events: CalendarEvent[] };

export function getConfiguredServerUrl() {
  return process.env.EXPO_PUBLIC_LMS_SERVER_URL?.replace(/\/$/, '') ?? null;
}

export async function fetchServerSnapshot(serverUrl: string): Promise<ServerSnapshot> {
  const response = await fetch(`${serverUrl}/api/snapshot`);
  if (!response.ok) throw new Error(`Local server returned ${response.status}.`);
  return response.json() as Promise<ServerSnapshot>;
}
