import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { assignments as seedAssignments, classes as seedClasses, type Assignment, type SubmissionType } from '../data/mockData';
import { isProtectedJson, protectJson, unprotectJson } from '../services/dataProtection';
import {LocalServerClient} from '../services/serverApi';

export type SchoolClass = { id: string; name: string; sectionName: string | null; teacher: string; location: string; grade: string; color: 'purple' | 'blue' | 'green' | 'orange'; description: string };
export type ClassMaterial = { id: string; classId: string; title: string; type: 'syllabus' | 'textbook' | 'resource'; uri: string | null; content: string };
export type QuizQuestionType = 'multiple_choice' | 'short_answer';
export type QuizQuestion = { id: string; quizId: string; prompt: string; type: QuizQuestionType; options: string[]; correctAnswer: string | null; points: number };
export type Quiz = { id: string; classId: string; title: string; description: string; dueDate: string; dueAt?: string; questions: QuizQuestion[] };
export type CalendarEvent = { id: string; title: string; date: string; time?: string; notes?: string; kind: 'assignment' | 'class' | 'school'; assignmentId?: string; localOnly?: boolean };
export type DashboardData = { assignments: Assignment[]; classes: SchoolClass[]; event: CalendarEvent | null; events: CalendarEvent[]; quizzes: Quiz[]; completedQuizIds: string[] };
export type Submission = { id: string; assignmentId: string; kind: SubmissionType; uri: string; fileName: string; mimeType: string; size: number | null; createdAt: string; status: 'completed' | 'pending' };
export type QuizAttempt = { id: string; quizId: string; score: number | null; status: 'awaiting_feedback' | 'graded' | 'ungraded'; submittedAt: string };
export type LocalUser = { id: string; username: string; displayName: string; role: 'student' | 'teacher' | 'administrator'; active: boolean };
export type RosterMember = LocalUser & { membershipRole: 'student' | 'teacher' };
export type TeacherReview = { submission: Submission; studentName: string; assignmentTitle: string; feedback: string | null; grade: number | null };
export type PendingOutboxChange = { id: string; type: string; payload: Record<string, unknown>; createdAt: string; attempts: number; lastError: string | null };

let database: SQLiteDatabase | null = null;
let databasePromise: Promise<SQLiteDatabase> | null = null;
let databaseName = 'locallearn.db';
let accountGeneration = 0;
export function accountScope() {return `${databaseName}:${accountGeneration}`;}
export function accountStorageName() {return databaseName;}
export function invalidateAccount() {accountGeneration++;}
export async function selectUserDatabase(userId: string) {
  invalidateAccount();
  if (database) await database.closeAsync();
  database = null;
  databasePromise = null;
  databaseName = `locallearn-${userId.replace(/[^a-zA-Z0-9-]/g, '_')}.db`;
}

async function getDatabase() {
  if (database) return database;
  if (!databasePromise) databasePromise = openDatabaseAsync(databaseName);
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
      completed INTEGER NOT NULL DEFAULT 0,
      tone TEXT NOT NULL,
      class_id TEXT,
      description TEXT NOT NULL DEFAULT '',
      due_date TEXT,
      submission_types TEXT NOT NULL DEFAULT '["file"]'
      ,grade INTEGER
      ,feedback TEXT
    );
    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      section_name TEXT,
      teacher TEXT NOT NULL,
      location TEXT NOT NULL,
      grade TEXT NOT NULL,
      color TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('student','teacher','administrator')), active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS class_memberships (
      class_id TEXT NOT NULL REFERENCES classes(id), user_id TEXT NOT NULL REFERENCES users(id),
      membership_role TEXT NOT NULL CHECK (membership_role IN ('student','teacher')), removed_at TEXT,
      PRIMARY KEY (class_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      event_date TEXT NOT NULL,
      event_time TEXT,
      notes TEXT,
      kind TEXT NOT NULL,
      assignment_id TEXT REFERENCES assignments(id),
      local_only INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY NOT NULL,
      assignment_id TEXT NOT NULL REFERENCES assignments(id),
      kind TEXT NOT NULL,
      uri TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER,
      content TEXT,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed'
    );
    CREATE TABLE IF NOT EXISTS class_materials (
      id TEXT PRIMARY KEY NOT NULL,
      class_id TEXT NOT NULL REFERENCES classes(id),
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      uri TEXT,
      content TEXT
    );
    CREATE TABLE IF NOT EXISTS quizzes (
      id TEXT PRIMARY KEY NOT NULL,
      class_id TEXT NOT NULL REFERENCES classes(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      due_date TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quiz_questions (
      id TEXT PRIMARY KEY NOT NULL,
      quiz_id TEXT NOT NULL REFERENCES quizzes(id),
      prompt TEXT NOT NULL,
      type TEXT NOT NULL,
      options TEXT NOT NULL DEFAULT '[]',
      correct_answer TEXT,
      points INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id TEXT PRIMARY KEY NOT NULL,
      quiz_id TEXT NOT NULL REFERENCES quizzes(id),
      answers TEXT NOT NULL,
      score INTEGER,
      graded INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS quiz_attempts_immutable_update BEFORE UPDATE ON quiz_attempts BEGIN SELECT RAISE(ABORT, 'Quiz attempts cannot be edited'); END;
    CREATE TRIGGER IF NOT EXISTS quiz_attempts_immutable_delete BEFORE DELETE ON quiz_attempts BEGIN SELECT RAISE(ABORT, 'Quiz attempts cannot be deleted'); END;
  `);

  await ensureAssignmentColumns(db);
  await ensureClassColumns(db);
  await ensureSubmissionColumns(db);
  await ensureMaterialColumns(db);
  await ensureEventColumns(db);
  await ensureQuizAttemptColumns(db);
  await ensureOutboxColumns(db);
  const quizColumns = await db.getAllAsync<{name: string}>('PRAGMA table_info(quizzes)');
  if (!quizColumns.some(column => column.name === 'due_at')) await db.execAsync('ALTER TABLE quizzes ADD COLUMN due_at TEXT');
  for (const table of ['assignments', 'classes', 'quizzes', 'class_materials']) {
    const columns = await db.getAllAsync<{name: string}>(`PRAGMA table_info(${table})`);
    if (!columns.some(column => column.name === 'server_visible')) await db.execAsync(`ALTER TABLE ${table} ADD COLUMN server_visible INTEGER NOT NULL DEFAULT 1`);
  }
  await db.execAsync('PRAGMA user_version = 4');

  // Authenticated accounts start with the authoritative server snapshot.
  await syncAssignmentEvents(db);
}

async function seedLocalUsers(db: SQLiteDatabase) {
  await db.runAsync("INSERT OR IGNORE INTO users (id, username, display_name, role) VALUES ('demo-student','student','Demo Student','student'),('demo-teacher','teacher','Demo Teacher','teacher'),('demo-admin','admin','School Administrator','administrator')");
  const teacher = await db.getFirstAsync<{ id: string }>("SELECT id FROM users WHERE role = 'teacher' LIMIT 1");
  const student = await db.getFirstAsync<{ id: string }>("SELECT id FROM users WHERE role = 'student' LIMIT 1");
  const classes = await db.getAllAsync<{ id: string }>('SELECT id FROM classes');
  for (const item of classes) {
    if (teacher) await db.runAsync("INSERT OR IGNORE INTO class_memberships (class_id,user_id,membership_role) VALUES (?,?,'teacher')", item.id, teacher.id);
    if (student) await db.runAsync("INSERT OR IGNORE INTO class_memberships (class_id,user_id,membership_role) VALUES (?,?,'student')", item.id, student.id);
  }
}

async function syncAssignmentEvents(db: SQLiteDatabase) {
  const assignments = await db.getAllAsync<{ id: string; title: string; dueDate: string; description: string; metadata: string }>("SELECT id, title, COALESCE(due_date, due) AS dueDate, COALESCE(description, '') AS description, metadata FROM assignments WHERE server_visible=1 AND (due_date IS NOT NULL OR due IS NOT NULL)");
  for (const assignment of assignments) {
    const eventDate = assignment.dueDate.replace(/^Due\s+/i, '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) continue;
    const dueAt = JSON.parse(assignment.metadata || '{}').dueAt;
    const time = dueAt ? new Date(dueAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', hour12: false}) : null;
    await db.runAsync('INSERT OR REPLACE INTO events (id, title, event_date, event_time, notes, kind, assignment_id) VALUES (?, ?, ?, ?, ?, ?, ?)', `assignment-event-${assignment.id}`, assignment.title, eventDate, time, assignment.description, 'assignment', assignment.id);
  }
}

async function ensureSubmissionColumns(db: SQLiteDatabase) {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(submissions)');
  if (!columns.some((column) => column.name === 'content')) await db.execAsync('ALTER TABLE submissions ADD COLUMN content TEXT');
  if (!columns.some((column) => column.name === 'submitted_for')) await db.execAsync('ALTER TABLE submissions ADD COLUMN submitted_for TEXT');
}

async function ensureMaterialColumns(db: SQLiteDatabase) {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(class_materials)');
  if (!columns.some((column) => column.name === 'content')) await db.execAsync('ALTER TABLE class_materials ADD COLUMN content TEXT');
}

async function ensureEventColumns(db: SQLiteDatabase) {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(events)');
  const existing = new Set(columns.map((column) => column.name));
  if (!existing.has('event_time')) await db.execAsync('ALTER TABLE events ADD COLUMN event_time TEXT');
  if (!existing.has('notes')) await db.execAsync("ALTER TABLE events ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
  if (!existing.has('local_only')) await db.execAsync('ALTER TABLE events ADD COLUMN local_only INTEGER NOT NULL DEFAULT 0');
}

async function ensureQuizAttemptColumns(db: SQLiteDatabase) {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(quiz_attempts)');
  const existing = new Set(columns.map((column) => column.name));
  if (!existing.has('encrypted_answers')) await db.execAsync('ALTER TABLE quiz_attempts ADD COLUMN encrypted_answers TEXT');
  if (!existing.has('nonce')) await db.execAsync('ALTER TABLE quiz_attempts ADD COLUMN nonce TEXT');
  if (!existing.has('integrity_hash')) await db.execAsync('ALTER TABLE quiz_attempts ADD COLUMN integrity_hash TEXT');
}

async function ensureAssignmentColumns(db: SQLiteDatabase) {
  const metadataColumns = await db.getAllAsync<{name: string}>('PRAGMA table_info(assignments)');
  if (!metadataColumns.some(c => c.name === 'metadata')) await db.execAsync("ALTER TABLE assignments ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'");
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(assignments)');
  const existing = new Set(columns.map((column) => column.name));
  if (!existing.has('completed')) await db.execAsync('ALTER TABLE assignments ADD COLUMN completed INTEGER NOT NULL DEFAULT 0');
  await db.execAsync("UPDATE assignments SET completed = CASE WHEN progress >= 100 OR status = 'Completed' THEN 1 ELSE 0 END WHERE completed = 0 AND (progress >= 100 OR status = 'Completed')");
  const additions = [
    ['class_id', 'TEXT'],
    ['description', "TEXT NOT NULL DEFAULT ''"],
    ['due_date', 'TEXT'],
    ['submission_types', "TEXT NOT NULL DEFAULT '[\"file\"]'"],
    ['grade', 'INTEGER'],
    ['feedback', 'TEXT'],
    ['protected_grade', 'TEXT'],
    ['protected_feedback', 'TEXT'],
  ];
  for (const [name, definition] of additions) {
    if (!existing.has(name)) await db.execAsync(`ALTER TABLE assignments ADD COLUMN ${name} ${definition}`);
  }
  const legacyRows = await db.getAllAsync<{ id: string; grade: number | null; feedback: string | null; protectedGrade: string | null; protectedFeedback: string | null }>('SELECT id, grade, feedback, protected_grade AS protectedGrade, protected_feedback AS protectedFeedback, metadata FROM assignments');
  for (const row of legacyRows) {
    if (row.grade !== null && !row.protectedGrade) {
      await db.runAsync('UPDATE assignments SET protected_grade = ?, grade = NULL WHERE id = ?', protectJson({ value: row.grade }), row.id);
    }
    if (row.feedback !== null && !row.protectedFeedback) {
      await db.runAsync('UPDATE assignments SET protected_feedback = ?, feedback = NULL WHERE id = ?', protectJson({ value: row.feedback }), row.id);
    }
  }
}

async function ensureClassColumns(db: SQLiteDatabase) {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(classes)');
  if (!columns.some((column) => column.name === 'section_name')) await db.execAsync('ALTER TABLE classes ADD COLUMN section_name TEXT');
  if (!columns.some((column) => column.name === 'description')) await db.execAsync("ALTER TABLE classes ADD COLUMN description TEXT NOT NULL DEFAULT ''");
}

async function ensureOutboxColumns(db: SQLiteDatabase) {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(outbox)');
  const existing = new Set(columns.map((column) => column.name));
  if (!existing.has('attempts')) await db.execAsync('ALTER TABLE outbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
  if (!existing.has('last_error')) await db.execAsync('ALTER TABLE outbox ADD COLUMN last_error TEXT');
}

async function seedDatabase(db: SQLiteDatabase) {
  const assignmentStatement = await db.prepareAsync('INSERT OR IGNORE INTO assignments (id, title, subject, teacher, due, progress, status, completed, tone, class_id, description, due_date, submission_types, grade, feedback) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const classStatement = await db.prepareAsync('INSERT OR IGNORE INTO classes (id, name, section_name, teacher, location, grade, color, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  try {
    for (const item of seedAssignments) await assignmentStatement.executeAsync(item.id, item.title, item.subject, item.teacher, item.due, item.completed ? 100 : 0, item.completed ? 'Completed' : 'In progress', item.completed ? 1 : 0, item.tone, item.classId, item.description, item.dueDate, JSON.stringify(item.submissionTypes), item.grade, item.feedback);
    for (const [name, teacherAndLocation, grade, color] of seedClasses) {
      const index = seedClasses.findIndex((entry) => entry[0] === name);
      const [teacher, location] = teacherAndLocation.split(' · ');
      await classStatement.executeAsync(`class-${index + 1}`, name, null, teacher, location, grade, color, `${name} course materials and class information.`);
    }
    await db.runAsync('INSERT OR IGNORE INTO events (id, title, event_date, kind, assignment_id) VALUES (?, ?, ?, ?, ?)', 'event-1', 'Quadratic equations practice due', '2026-11-13', 'assignment', 'algebra-1');
    await db.runAsync('INSERT OR IGNORE INTO class_materials (id, class_id, title, type, uri, content) VALUES (?, ?, ?, ?, ?, ?)', 'material-1', 'class-1', 'Algebra II syllabus', 'syllabus', null, 'Course overview, grading policy, classroom expectations, and the topics covered this semester.');
    await db.runAsync('INSERT OR IGNORE INTO class_materials (id, class_id, title, type, uri, content) VALUES (?, ?, ?, ?, ?, ?)', 'material-2', 'class-1', 'Algebra II textbook', 'textbook', null, 'Algebra II reference textbook. Chapters 1–4 cover functions, equations, and graphing.');
    await db.runAsync('INSERT OR IGNORE INTO class_materials (id, class_id, title, type, uri, content) VALUES (?, ?, ?, ?, ?, ?)', 'material-3', 'class-2', 'World History syllabus', 'syllabus', null, 'This course studies major social, political, and economic changes from 1750 to the present.');
    await db.runAsync('INSERT OR IGNORE INTO quizzes (id, class_id, title, description, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?)', 'quiz-1', 'class-1', 'Functions check-in', 'A short practice quiz on functions and graphing.', '2026-11-22', new Date().toISOString());
    await db.runAsync('INSERT OR IGNORE INTO quiz_questions (id, quiz_id, prompt, type, options, correct_answer, points) VALUES (?, ?, ?, ?, ?, ?, ?)', 'quiz-1-q1', 'quiz-1', 'What is the slope of y = 2x + 3?', 'multiple_choice', JSON.stringify(['2', '3', '-2', '0']), '2', 1);
    await db.runAsync('INSERT OR IGNORE INTO quiz_questions (id, quiz_id, prompt, type, options, correct_answer, points) VALUES (?, ?, ?, ?, ?, ?, ?)', 'quiz-1-q2', 'quiz-1', 'In your own words, what does the y-intercept describe?', 'short_answer', '[]', null, 2);
    await db.runAsync('INSERT OR IGNORE INTO quiz_questions (id, quiz_id, prompt, type, options, correct_answer, points) VALUES (?, ?, ?, ?, ?, ?, ?)', 'quiz-1-q3', 'quiz-1', 'Which graph represents a linear function?', 'multiple_choice', JSON.stringify(['A straight line', 'A circle', 'A parabola only', 'A random scatter']), 'A straight line', 1);
    await db.runAsync('INSERT OR IGNORE INTO sync_metadata (key, value) VALUES (?, ?)', 'last_sync', 'Just now');
  } finally {
    await assignmentStatement.finalizeAsync();
    await classStatement.finalizeAsync();
  }
}

export async function getDashboardData(): Promise<DashboardData> {
  const db = await getDatabase();
  const assignmentRows = await db.getAllAsync<AssignmentRow>('SELECT id, title, subject, teacher, due, completed AS completedValue, tone, class_id AS classId, COALESCE(description, \'\') AS description, COALESCE(due_date, due) AS dueDate, COALESCE(submission_types, \'["file"]\') AS submissionTypesJson, grade, feedback, protected_grade AS protectedGrade, protected_feedback AS protectedFeedback, metadata FROM assignments WHERE server_visible=1 ORDER BY COALESCE(due_date, due)');
  const classRows = await db.getAllAsync<SchoolClass>('SELECT id, name, section_name AS sectionName, teacher, location, grade, color, COALESCE(description, \'\') AS description FROM classes WHERE server_visible=1 ORDER BY name');
  const eventRows = await db.getAllAsync<CalendarEventRow>('SELECT id, title, event_date AS date, event_time AS time, notes, kind, assignment_id AS assignmentId, local_only AS localOnlyValue FROM events ORDER BY event_date, event_time');
  const events = eventRows.map(mapCalendarEvent);
  const quizRows = await db.getAllAsync<Omit<Quiz, 'questions'>>('SELECT id, class_id AS classId, title, description, due_date AS dueDate, due_at AS dueAt FROM quizzes WHERE server_visible=1 ORDER BY due_date');
  const quizzes = await Promise.all(quizRows.map(async (quiz) => ({ ...quiz, questions: await getQuizQuestions(quiz.id) })));
  const completedQuizRows = await db.getAllAsync<{ quizId: string }>('SELECT quiz_id AS quizId FROM quiz_attempts');
  const snapshot = await cachedValue<{quizAttempts?: {quizId: string}[]}>('/api/snapshot');
  for (const attempt of snapshot?.quizAttempts ?? []) if (!completedQuizRows.some(q => q.quizId === attempt.quizId)) completedQuizRows.push({quizId: attempt.quizId});
  return { assignments: assignmentRows.map(mapAssignment), classes: classRows, event: events[0] ?? null, events, quizzes, completedQuizIds: completedQuizRows.map((row) => row.quizId) };
}

export async function applyServerSnapshot(snapshot: { assignments: Assignment[]; classes: SchoolClass[]; events: CalendarEvent[]; quizzes?: Quiz[]; materials?: ClassMaterial[] }) {
  for (const item of snapshot.assignments) {
    if (item.dueAt) {const date = new Date(item.dueAt); item.dueDate = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
  }
  for (const quiz of snapshot.quizzes ?? []) {
    if (quiz.dueAt) {const date = new Date(quiz.dueAt); quiz.dueDate = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
  }
  const db = await getDatabase();
  const pendingIds = (await getPendingChanges()).filter(change => change.type === 'mutation').map(change => String((change.payload.body as Record<string, unknown>)?.id ?? ''));
  await db.withTransactionAsync(async () => {
    // Retain records referenced by immutable attempts or unsent work, but remove
    // revoked classes/assignments from navigation after an authoritative refresh.
    for (const table of ['assignments', 'classes', 'quizzes', 'class_materials']) {
      await db.runAsync(`UPDATE ${table} SET server_visible=0`);
      for (const id of pendingIds) await db.runAsync(`UPDATE ${table} SET server_visible=1 WHERE id=?`, id);
    }
    await db.runAsync('DELETE FROM events WHERE local_only=0');
    for (const item of snapshot.classes) await db.runAsync('INSERT OR REPLACE INTO classes (id, name, section_name, teacher, location, grade, color, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', item.id, item.name, item.sectionName ?? null, item.teacher, item.location, item.grade, item.color, item.description);
    for (const item of snapshot.assignments) await db.runAsync('INSERT OR REPLACE INTO assignments (id, title, subject, teacher, due, progress, status, completed, tone, class_id, description, due_date, submission_types, grade, feedback, protected_grade, protected_feedback) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', item.id, item.title, item.subject, item.teacher, item.due, item.completed ? 100 : 0, item.completed ? 'Completed' : 'In progress', item.completed ? 1 : 0, item.tone, item.classId, item.description, item.dueDate, JSON.stringify(item.submissionTypes), null, null, item.grade === null ? null : protectJson({ value: item.grade }), item.feedback === null ? null : protectJson({ value: item.feedback }));
    for (const item of snapshot.assignments) await db.runAsync('UPDATE assignments SET metadata=? WHERE id=?', JSON.stringify({recipientIds: item.recipientIds ?? [], gradeLabel: item.gradeLabel ?? null, resources: item.resources ?? [], dueAt: item.dueAt, allowResubmission: item.allowResubmission, allowLate: item.allowLate, submissionStatus: item.submissionStatus, submittedAt: item.submittedAt}), item.id);
    // A server snapshot must not make a still-queued local submission disappear.
    await db.runAsync("UPDATE assignments SET completed=1, progress=100, status='Saved locally', metadata=json_set(metadata, '$.submissionStatus', 'saved_locally') WHERE id IN (SELECT assignment_id FROM submissions WHERE status='pending' AND submitted_for IS NULL)");
    await syncAssignmentEvents(db);
    for (const item of snapshot.events) await db.runAsync('INSERT OR REPLACE INTO events (id, title, event_date, event_time, notes, kind, assignment_id, local_only) VALUES (?, ?, ?, ?, ?, ?, ?, 0)', item.id, item.title, item.date, item.time ?? null, item.notes ?? '', item.kind, item.assignmentId ?? null);
    await db.runAsync('INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)', 'last_sync', new Date().toISOString());
    for (const q of snapshot.quizzes ?? []) {
      await db.runAsync('DELETE FROM quiz_questions WHERE quiz_id=?', q.id);
      await db.runAsync('INSERT OR REPLACE INTO quizzes (id, class_id, title, description, due_date, created_at, due_at) VALUES (?, ?, ?, ?, ?, ?, ?)', q.id, q.classId, q.title, q.description, q.dueDate, new Date().toISOString(), q.dueAt ?? null);
      for (const item of q.questions) await db.runAsync('INSERT OR REPLACE INTO quiz_questions VALUES (?, ?, ?, ?, ?, ?, ?)', item.id, q.id, item.prompt, item.type, JSON.stringify(item.options), null, item.points);
    }
    const visibleQuizzes = await db.getAllAsync<{id: string; title: string; dueDate: string; dueAt: string | null; description: string}>('SELECT id, title, due_date AS dueDate, due_at AS dueAt, description FROM quizzes WHERE server_visible=1');
    for (const q of visibleQuizzes) await db.runAsync('INSERT OR REPLACE INTO events (id, title, event_date, event_time, notes, kind, assignment_id) VALUES (?, ?, ?, ?, ?, ?, NULL)', `quiz-event-${q.id}`, q.title, q.dueDate, q.dueAt ? new Date(q.dueAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', hour12: false}) : null, q.description, 'class');
    for (const m of snapshot.materials ?? []) await db.runAsync('INSERT OR REPLACE INTO class_materials (id, class_id, title, type, uri, content) VALUES (?, ?, ?, ?, ?, ?)', m.id, m.classId, m.title, m.type, m.uri, m.content);
  });
}

type AssignmentRow = Omit<Assignment, 'submissionTypes' | 'completed'> & { metadata?: string; submissionTypesJson: string; classId: string | null; completedValue: number; protectedGrade: string | null; protectedFeedback: string | null };
type CalendarEventRow = Omit<CalendarEvent, 'localOnly'> & { localOnlyValue: number };

function mapCalendarEvent(row: CalendarEventRow): CalendarEvent {
  return { ...row, localOnly: row.localOnlyValue === 1 };
}

function mapAssignment(row: AssignmentRow): Assignment {
  let grade = row.grade;
  let feedback = row.feedback;
  try { if (row.protectedGrade) grade = unprotectJson<{ value: number }>(row.protectedGrade).value; } catch (_) { grade = null; }
  try { if (row.protectedFeedback) feedback = unprotectJson<{ value: string }>(row.protectedFeedback).value; } catch (_) { feedback = null; }
  return { ...row, ...JSON.parse(row.metadata || '{}'), completed: row.completedValue === 1, classId: row.classId ?? '', submissionTypes: JSON.parse(row.submissionTypesJson || '["file"]') as SubmissionType[], grade, feedback };
}

export async function createAssignment(input: Omit<Assignment, 'id' | 'due'> & { id?: string; due?: string }) {
  const id = input.id ?? `assignment-${Date.now()}`;
  const due = input.due ?? `Due ${input.dueDate}`;
  await (await getDatabase()).runAsync('INSERT INTO assignments (id, title, subject, teacher, due, progress, status, completed, tone, class_id, description, due_date, submission_types, grade, feedback, protected_grade, protected_feedback) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, input.title, input.subject, input.teacher, due, input.completed ? 100 : 0, input.completed ? 'Completed' : 'In progress', input.completed ? 1 : 0, input.tone, input.classId, input.description, input.dueDate, JSON.stringify(input.submissionTypes), null, null, input.grade === null ? null : protectJson({ value: input.grade }), input.feedback === null ? null : protectJson({ value: input.feedback }));
  await (await getDatabase()).runAsync('INSERT OR REPLACE INTO events (id, title, event_date, event_time, notes, kind, assignment_id) VALUES (?, ?, ?, ?, ?, ?, ?)', `assignment-event-${id}`, input.title, input.dueDate, null, input.description, 'assignment', id);
  await (await getDatabase()).runAsync('UPDATE assignments SET metadata=? WHERE id=?', JSON.stringify({recipientIds: input.recipientIds ?? [], gradeLabel: input.gradeLabel ?? null, dueAt: input.dueAt, allowLate: input.allowLate, allowResubmission: input.allowResubmission, resources: input.resources ?? []}), id);
  return id;
}

export async function createClass(input: Omit<SchoolClass, 'id'> & { id?: string }) {
  const id = input.id ?? `class-${Date.now()}`;
  await (await getDatabase()).runAsync('INSERT INTO classes (id, name, section_name, teacher, location, grade, color, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, input.name, input.sectionName ?? null, input.teacher, input.location, input.grade, input.color, input.description);
  return id;
}

export async function getClassDetail(classId: string) {
  const db = await getDatabase();
  const classRow = await db.getFirstAsync<SchoolClass>('SELECT id, name, section_name AS sectionName, teacher, location, grade, color, COALESCE(description, \'\') AS description FROM classes WHERE server_visible=1 AND id = ?', classId);
  const assignmentRows = await db.getAllAsync<AssignmentRow>('SELECT id, title, subject, teacher, due, completed AS completedValue, tone, class_id AS classId, COALESCE(description, \'\') AS description, COALESCE(due_date, due) AS dueDate, COALESCE(submission_types, \'["file"]\') AS submissionTypesJson, grade, feedback, protected_grade AS protectedGrade, protected_feedback AS protectedFeedback, metadata FROM assignments WHERE server_visible=1 AND class_id = ? ORDER BY COALESCE(due_date, due)', classId);
  const materials = await db.getAllAsync<ClassMaterial>('SELECT id, class_id AS classId, title, type, uri, COALESCE(content, \'\') AS content FROM class_materials WHERE server_visible=1 AND class_id = ? ORDER BY title', classId);
  const quizRows = await db.getAllAsync<Omit<Quiz, 'questions'>>('SELECT id, class_id AS classId, title, description, due_date AS dueDate, due_at AS dueAt FROM quizzes WHERE server_visible=1 AND class_id = ? ORDER BY due_date', classId);
  const quizzes = await Promise.all(quizRows.map(async (quiz) => ({ ...quiz, questions: await getQuizQuestions(quiz.id) })));
  return { classRow: classRow ?? null, assignments: assignmentRows.map(mapAssignment), materials, quizzes };
}

export async function saveMaterialLocally(material: ClassMaterial) {
  await (await getDatabase()).runAsync('INSERT OR REPLACE INTO class_materials (id, class_id, title, type, uri, content) VALUES (?, ?, ?, ?, ?, ?)', material.id, material.classId, material.title, material.type, material.uri, material.content);
}

async function getQuizQuestions(quizId: string) {
  const rows = await (await getDatabase()).getAllAsync<{ id: string; quizId: string; prompt: string; type: QuizQuestionType; options: string; correctAnswer: string | null; points: number }>('SELECT id, quiz_id AS quizId, prompt, type, options, correct_answer AS correctAnswer, points FROM quiz_questions WHERE quiz_id = ? ORDER BY rowid', quizId);
  return rows.map((row) => ({ ...row, options: JSON.parse(row.options || '[]') as string[] }));
}

export async function createQuiz(input: { id?: string; classId: string; title: string; description: string; dueDate: string; dueAt?: string; questions: (Omit<QuizQuestion, 'id' | 'quizId'> & {id?: string})[] }) {
  const id = input.id ?? `quiz-${Date.now()}`;
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('INSERT INTO quizzes (id, class_id, title, description, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, input.classId, input.title, input.description, input.dueDate, new Date().toISOString());
    await db.runAsync('UPDATE quizzes SET due_at=? WHERE id=?', input.dueAt ?? null, id);
    for (const [index, question] of input.questions.entries()) await db.runAsync('INSERT INTO quiz_questions (id, quiz_id, prompt, type, options, correct_answer, points) VALUES (?, ?, ?, ?, ?, ?, ?)', question.id ?? `${id}-q${index + 1}`, id, question.prompt, question.type, JSON.stringify(question.options), question.correctAnswer, question.points);
  });
  return id;
}

export async function getQuizAttempt(quizId: string) {
  const snapshot = await cachedValue<{quizAttempts?: QuizAttempt[]}>('/api/snapshot');
  const authoritative = snapshot?.quizAttempts?.find(q => q.quizId === quizId);
  if(authoritative) return authoritative;
  return (await (await getDatabase()).getFirstAsync<QuizAttempt>('SELECT id, quiz_id AS quizId, score, status, created_at AS submittedAt FROM quiz_attempts WHERE quiz_id = ? ORDER BY rowid LIMIT 1', quizId)) ?? null;
}

export async function submitQuizAttempt(quiz: Quiz, answers: Record<string, string>) {
  const existing = await getQuizAttempt(quiz.id);
  if (existing) return { ...existing, alreadySubmitted: true as const };
  const id = `attempt-${Date.now()}`;
  const encrypted = protectJson(answers);
  const {nonce: nonceValue, digest: integrityHash} = JSON.parse(encrypted) as {nonce: string; digest: string};
  const submittedAt = new Date().toISOString();
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('INSERT INTO quiz_attempts (id, quiz_id, answers, encrypted_answers, nonce, integrity_hash, score, graded, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, quiz.id, 'ENCRYPTED', encrypted, nonceValue, integrityHash, null, 0, 'awaiting_feedback', submittedAt);
    await db.runAsync('INSERT INTO outbox (id, type, payload, created_at) VALUES (?, ?, ?, ?)', id, 'quiz-attempt', protectJson({quizId: quiz.id, answers}), submittedAt);
  });
  return { id, quizId: quiz.id, score: null, status: 'awaiting_feedback' as const, submittedAt, alreadySubmitted: false as const };
}

export async function createEvent(input: Omit<CalendarEvent, 'id'> & { id?: string }) {
  const id = input.id ?? `event-${Date.now()}`;
  await (await getDatabase()).runAsync('INSERT INTO events (id, title, event_date, event_time, notes, kind, assignment_id, local_only) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, input.title, input.date, input.time ?? null, input.notes ?? '', input.kind, input.assignmentId ?? null, input.localOnly ? 1 : 0);
  return id;
}

export async function updateEvent(id: string, input: Omit<CalendarEvent, 'id'>) {
  await (await getDatabase()).runAsync('UPDATE events SET title = ?, event_date = ?, event_time = ?, notes = ?, kind = ?, assignment_id = ? WHERE id = ? AND local_only = 1', input.title, input.date, input.time ?? null, input.notes ?? '', input.kind, input.assignmentId ?? null, id);
}

export async function createSubmission(input: Omit<Submission, 'id' | 'createdAt' | 'status'> & { id?: string; content?: string | null; studentId?: string }) {
  const id = input.id ?? `submission-${Date.now()}`;
  const createdAt = new Date().toISOString();
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    const protectedContent = input.content === null || input.content === undefined ? null : protectJson({ content: input.content });
    await db.runAsync('INSERT INTO submissions (id, assignment_id, kind, uri, file_name, mime_type, size, content, created_at, status, submitted_for) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, input.assignmentId, input.kind, input.uri, input.fileName, input.mimeType, input.size ?? null, protectedContent, createdAt, 'pending', input.studentId ?? null);
    if (!input.studentId) await db.runAsync("UPDATE assignments SET completed=1, progress=100, status=?, metadata=json_set(metadata, '$.submissionStatus', 'saved_locally') WHERE id=?", 'Saved locally — pending transfer', input.assignmentId);
    await db.runAsync('INSERT OR REPLACE INTO outbox (id, type, payload, created_at) VALUES (?, ?, ?, ?)', `submission-${id}`, 'submission', protectJson({ id, assignmentId: input.assignmentId, studentId: input.studentId, kind: input.kind, uri: input.uri, fileName: input.fileName, mimeType: input.mimeType, content: input.content ?? null }), createdAt);
  });
  return id;
}

export async function getSubmissions(assignmentId: string) {
  return (await (await getDatabase()).getAllAsync<Submission>('SELECT id, assignment_id AS assignmentId, kind, uri, file_name AS fileName, mime_type AS mimeType, size, created_at AS createdAt, status FROM submissions WHERE assignment_id = ? ORDER BY created_at DESC', assignmentId));
}

export async function deleteEvent(id: string) {
  const db = await getDatabase();
  const event = await db.getFirstAsync<{ kind: CalendarEvent['kind']; assignmentId: string | null; localOnly: number }>('SELECT kind, assignment_id AS assignmentId, local_only AS localOnly FROM events WHERE id = ?', id);
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM events WHERE id = ?', id);
    if (event?.localOnly !== 1 && event?.kind === 'assignment' && event.assignmentId) {
      await db.runAsync('DELETE FROM assignments WHERE id = ?', event.assignmentId);
    }
  });
}

export async function updateAssignmentCompletion(id: string, completed: boolean) {
  const db = await getDatabase();
  await db.runAsync('UPDATE assignments SET completed = ? WHERE id = ?', completed ? 1 : 0, id);
  await db.runAsync('INSERT OR REPLACE INTO outbox (id, type, payload, created_at) VALUES (?, ?, ?, ?)', `completion-${id}`, 'assignment-completion', protectJson({ id, completed }), new Date().toISOString());
}

export async function getPendingChangeCount() {
  return (await (await getDatabase()).getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM outbox'))?.count ?? 0;
}

export async function getPendingChanges() {
  const rows = await (await getDatabase()).getAllAsync<{ id: string; type: string; payload: string; createdAt: string; attempts: number; lastError: string | null }>('SELECT id, type, payload, created_at AS createdAt, attempts, last_error AS lastError FROM outbox ORDER BY created_at');
  const changes: PendingOutboxChange[] = [];
  for (const row of rows) {
    try {
      const payload = isProtectedJson(row.payload)
        ? unprotectJson<Record<string, unknown>>(row.payload)
        : JSON.parse(row.payload) as Record<string, unknown>;
      changes.push({ ...row, payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read protected outbox data.';
      await recordPendingChangeFailure(row.id, message);
    }
  }
  return changes;
}

export async function recordPendingChangeFailure(id: string, error: string) {
  await (await getDatabase()).runAsync('UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?', error, id);
}

export async function removePendingChange(id: string) {
  await (await getDatabase()).runAsync('DELETE FROM outbox WHERE id = ?', id);
}

export async function enqueuePendingChange(change: { id: string; type: string; payload: Record<string, unknown>; createdAt: string }) {
  await (await getDatabase()).runAsync('INSERT OR REPLACE INTO outbox (id, type, payload, created_at) VALUES (?, ?, ?, ?)', change.id, change.type, protectJson(change.payload), change.createdAt);
}

export async function clearPendingChanges() {
  await (await getDatabase()).runAsync('DELETE FROM outbox');
}

export async function cacheValue(key: string, value: unknown) {
  await (await getDatabase()).runAsync('INSERT OR REPLACE INTO sync_metadata VALUES (?, ?)', `cache:${key}`, protectJson(value));
}
export async function cachedValue<T>(key: string): Promise<T | null> {
  const row = await (await getDatabase()).getFirstAsync<{value: string}>('SELECT value FROM sync_metadata WHERE key=?', `cache:${key}`);
  return row ? unprotectJson<T>(row.value) : null;
}
export async function queueMutation(path: string, method: string, body: Record<string, unknown>) {
  const id = `mutation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await (await getDatabase()).runAsync('INSERT INTO outbox (id, type, payload, created_at) VALUES (?, ?, ?, ?)', id, 'mutation', protectJson({path, method, body}), new Date().toISOString());
}
export async function acknowledgeSubmission(id: string) {
  await (await getDatabase()).runAsync("UPDATE submissions SET status='completed' WHERE id=?", id);
}

export async function getLocalUsers() {
  return (await (await getDatabase()).getAllAsync<LocalUser>('SELECT id, username, display_name AS displayName, role, active FROM users ORDER BY role, display_name')).map((user) => ({ ...user, active: Boolean(user.active) }));
}

export async function saveLocalUser(input: Omit<LocalUser, 'id' | 'active'> & { id?: string; active?: boolean }) {
  const id = input.id ?? `user-${Date.now()}`;
  await (await getDatabase()).runAsync('INSERT OR REPLACE INTO users (id, username, display_name, role, active) VALUES (?, ?, ?, ?, ?)', id, input.username, input.displayName, input.role, input.active === false ? 0 : 1);
  return id;
}

export async function setLocalUserActive(id: string, active: boolean) { await (await getDatabase()).runAsync('UPDATE users SET active = ? WHERE id = ?', active ? 1 : 0, id); }

export async function getClassRoster(classId: string) {
  return (await (await getDatabase()).getAllAsync<RosterMember>('SELECT u.id, u.username, u.display_name AS displayName, u.role, u.active, m.membership_role AS membershipRole FROM users u JOIN class_memberships m ON m.user_id = u.id WHERE m.class_id = ? AND m.removed_at IS NULL ORDER BY m.membership_role, u.display_name', classId)).map((member) => ({ ...member, active: Boolean(member.active) }));
}

export async function saveClassMembership(classId: string, userId: string, membershipRole: 'student' | 'teacher') { await (await getDatabase()).runAsync('INSERT OR REPLACE INTO class_memberships (class_id, user_id, membership_role, removed_at) VALUES (?, ?, ?, NULL)', classId, userId, membershipRole); }

export async function removeClassMembership(classId: string, userId: string) { await (await getDatabase()).runAsync('UPDATE class_memberships SET removed_at = ? WHERE class_id = ? AND user_id = ?', new Date().toISOString(), classId, userId); }

export async function getTeacherReviews() {
  const rows = await (await getDatabase()).getAllAsync<Submission & { studentName: string; assignmentTitle: string; protectedGrade: string | null; protectedFeedback: string | null }>("SELECT s.id, s.assignment_id AS assignmentId, s.kind, s.uri, s.file_name AS fileName, s.mime_type AS mimeType, s.size, s.created_at AS createdAt, s.status, COALESCE(u.display_name, 'Student') AS studentName, a.title AS assignmentTitle, a.protected_grade AS protectedGrade, a.protected_feedback AS protectedFeedback FROM submissions s JOIN assignments a ON a.id = s.assignment_id LEFT JOIN users u ON u.role = 'student' ORDER BY s.created_at DESC");
  return rows.map((row) => {
    const assignment = mapAssignment({ id: '', title: '', subject: '', teacher: '', due: '', completedValue: 0, tone: 'math', classId: '', description: '', dueDate: '', submissionTypesJson: '["file"]', grade: null, feedback: null, protectedGrade: row.protectedGrade, protectedFeedback: row.protectedFeedback });
    return { submission: row, studentName: row.studentName, assignmentTitle: row.assignmentTitle, feedback: assignment.feedback, grade: assignment.grade };
  });
}

export async function saveGrade(assignmentId: string, grade: number | null, feedback: string, status: 'graded' | 'returned' | 'revision_requested') {
  const db = await getDatabase();
  await db.runAsync('UPDATE assignments SET grade = NULL, feedback = NULL, protected_grade = ?, protected_feedback = ?, status = ? WHERE id = ?', grade === null ? null : protectJson({ value: grade }), protectJson({ value: feedback }), status, assignmentId);
  await db.runAsync('INSERT OR REPLACE INTO outbox (id, type, payload, created_at) VALUES (?, ?, ?, ?)', `grade-${assignmentId}`, 'grade', protectJson({ assignmentId, grade, feedback, status }), new Date().toISOString());
}
