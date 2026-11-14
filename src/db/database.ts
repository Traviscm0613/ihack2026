import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { assignments as seedAssignments, classes as seedClasses, type Assignment } from '../data/mockData';

export type SchoolClass = { id: string; name: string; teacher: string; location: string; grade: string; color: 'purple' | 'blue' | 'green' | 'orange' };
export type CalendarEvent = { id: string; title: string; date: string; kind: 'assignment' | 'class' | 'school'; assignmentId?: string };
export type DashboardData = { assignments: Assignment[]; classes: SchoolClass[]; event: CalendarEvent | null };

let database: SQLiteDatabase | null = null;
let databasePromise: Promise<SQLiteDatabase> | null = null;

async function getDatabase() {
  if (database) return database;
  if (!databasePromise) databasePromise = openDatabaseAsync('locallearn.db');
  database = await databasePromise;
  return database;
}

export async function initializeDatabase() {
  const db = await getDatabase();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      subject TEXT NOT NULL,
      teacher TEXT NOT NULL,
      due TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      tone TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      teacher TEXT NOT NULL,
      location TEXT NOT NULL,
      grade TEXT NOT NULL,
      color TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      event_date TEXT NOT NULL,
      kind TEXT NOT NULL,
      assignment_id TEXT REFERENCES assignments(id)
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);

  await seedDatabase(db);
}

async function seedDatabase(db: SQLiteDatabase) {
  const assignmentStatement = await db.prepareAsync('INSERT OR IGNORE INTO assignments (id, title, subject, teacher, due, progress, status, tone) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const classStatement = await db.prepareAsync('INSERT OR IGNORE INTO classes (id, name, teacher, location, grade, color) VALUES (?, ?, ?, ?, ?, ?)');
  try {
    for (const item of seedAssignments) await assignmentStatement.executeAsync(item.id, item.title, item.subject, item.teacher, item.due, item.progress, item.status, item.tone);
    for (const [name, teacherAndLocation, grade, color] of seedClasses) {
      const index = seedClasses.findIndex((entry) => entry[0] === name);
      const [teacher, location] = teacherAndLocation.split(' · ');
      await classStatement.executeAsync(`class-${index + 1}`, name, teacher, location, grade, color);
    }
    await db.runAsync('INSERT OR IGNORE INTO events (id, title, event_date, kind, assignment_id) VALUES (?, ?, ?, ?, ?)', 'event-1', 'Quadratic equations practice due', '2026-11-13', 'assignment', 'algebra-1');
    await db.runAsync('INSERT OR IGNORE INTO sync_metadata (key, value) VALUES (?, ?)', 'last_sync', 'Just now');
  } finally {
    await assignmentStatement.finalizeAsync();
    await classStatement.finalizeAsync();
  }
}

export async function getDashboardData(): Promise<DashboardData> {
  const db = await getDatabase();
  const assignmentRows = await db.getAllAsync<Assignment>('SELECT id, title, subject, teacher, due, progress, status, tone FROM assignments ORDER BY due');
  const classRows = await db.getAllAsync<SchoolClass>('SELECT id, name, teacher, location, grade, color FROM classes ORDER BY name');
  const event = await db.getFirstAsync<CalendarEvent>('SELECT id, title, event_date AS date, kind, assignment_id AS assignmentId FROM events ORDER BY event_date LIMIT 1');
  return { assignments: assignmentRows, classes: classRows, event: event ?? null };
}

export async function createAssignment(input: Omit<Assignment, 'id'> & { id?: string }) {
  const id = input.id ?? `assignment-${Date.now()}`;
  await (await getDatabase()).runAsync('INSERT INTO assignments (id, title, subject, teacher, due, progress, status, tone) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, input.title, input.subject, input.teacher, input.due, input.progress, input.status, input.tone);
  return id;
}

export async function createEvent(input: Omit<CalendarEvent, 'id'> & { id?: string }) {
  const id = input.id ?? `event-${Date.now()}`;
  await (await getDatabase()).runAsync('INSERT INTO events (id, title, event_date, kind, assignment_id) VALUES (?, ?, ?, ?, ?)', id, input.title, input.date, input.kind, input.assignmentId ?? null);
  return id;
}

export async function updateAssignmentProgress(id: string, progress: number, status: Assignment['status']) {
  const db = await getDatabase();
  await db.runAsync('UPDATE assignments SET progress = ?, status = ? WHERE id = ?', progress, status, id);
  await db.runAsync('INSERT OR REPLACE INTO outbox (id, type, payload, created_at) VALUES (?, ?, ?, ?)', `progress-${id}`, 'assignment-progress', JSON.stringify({ id, progress, status }), new Date().toISOString());
}

export async function getPendingChangeCount() {
  return (await (await getDatabase()).getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM outbox'))?.count ?? 0;
}

export async function enqueuePendingChange(change: { id: string; type: string; payload: Record<string, string | number>; createdAt: string }) {
  await (await getDatabase()).runAsync('INSERT OR REPLACE INTO outbox (id, type, payload, created_at) VALUES (?, ?, ?, ?)', change.id, change.type, JSON.stringify(change.payload), change.createdAt);
}

export async function clearPendingChanges() {
  await (await getDatabase()).runAsync('DELETE FROM outbox');
}
