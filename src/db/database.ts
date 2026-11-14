import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { assignments as seedAssignments, classes as seedClasses, type Assignment, type SubmissionType } from '../data/mockData';

export type SchoolClass = { id: string; name: string; teacher: string; location: string; grade: string; color: 'purple' | 'blue' | 'green' | 'orange'; description: string };
export type ClassMaterial = { id: string; classId: string; title: string; type: 'syllabus' | 'textbook' | 'resource'; uri: string | null; content: string };
export type QuizQuestionType = 'multiple_choice' | 'short_answer';
export type QuizQuestion = { id: string; quizId: string; prompt: string; type: QuizQuestionType; options: string[]; correctAnswer: string | null; points: number };
export type Quiz = { id: string; classId: string; title: string; description: string; dueDate: string; questions: QuizQuestion[] };
export type CalendarEvent = { id: string; title: string; date: string; time?: string; notes?: string; kind: 'assignment' | 'class' | 'school'; assignmentId?: string };
export type DashboardData = { assignments: Assignment[]; classes: SchoolClass[]; event: CalendarEvent | null; events: CalendarEvent[] };
export type Submission = { id: string; assignmentId: string; kind: SubmissionType; uri: string; fileName: string; mimeType: string; size: number | null; createdAt: string; status: 'completed' | 'pending' };

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
      teacher TEXT NOT NULL,
      location TEXT NOT NULL,
      grade TEXT NOT NULL,
      color TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      event_date TEXT NOT NULL,
      event_time TEXT,
      notes TEXT,
      kind TEXT NOT NULL,
      assignment_id TEXT REFERENCES assignments(id)
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
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
  `);

  await ensureAssignmentColumns(db);
  await ensureClassColumns(db);
  await ensureSubmissionColumns(db);
  await ensureMaterialColumns(db);
  await ensureEventColumns(db);

  if (process.env.NODE_ENV !== 'production') await seedDatabase(db);
}

async function ensureSubmissionColumns(db: SQLiteDatabase) {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(submissions)');
  if (!columns.some((column) => column.name === 'content')) await db.execAsync('ALTER TABLE submissions ADD COLUMN content TEXT');
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
}

async function ensureAssignmentColumns(db: SQLiteDatabase) {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(assignments)');
  const existing = new Set(columns.map((column) => column.name));
  const additions = [
    ['class_id', 'TEXT'],
    ['description', "TEXT NOT NULL DEFAULT ''"],
    ['due_date', 'TEXT'],
    ['submission_types', "TEXT NOT NULL DEFAULT '[\"file\"]'"],
    ['grade', 'INTEGER'],
    ['feedback', 'TEXT'],
  ];
  for (const [name, definition] of additions) {
    if (!existing.has(name)) await db.execAsync(`ALTER TABLE assignments ADD COLUMN ${name} ${definition}`);
  }
}

async function ensureClassColumns(db: SQLiteDatabase) {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(classes)');
  if (!columns.some((column) => column.name === 'description')) await db.execAsync("ALTER TABLE classes ADD COLUMN description TEXT NOT NULL DEFAULT ''");
}

async function seedDatabase(db: SQLiteDatabase) {
  const assignmentStatement = await db.prepareAsync('INSERT OR IGNORE INTO assignments (id, title, subject, teacher, due, progress, status, tone, class_id, description, due_date, submission_types, grade, feedback) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const classStatement = await db.prepareAsync('INSERT OR IGNORE INTO classes (id, name, teacher, location, grade, color, description) VALUES (?, ?, ?, ?, ?, ?, ?)');
  try {
    for (const item of seedAssignments) await assignmentStatement.executeAsync(item.id, item.title, item.subject, item.teacher, item.due, item.progress, item.status, item.tone, item.classId, item.description, item.dueDate, JSON.stringify(item.submissionTypes), item.grade, item.feedback);
    for (const [name, teacherAndLocation, grade, color] of seedClasses) {
      const index = seedClasses.findIndex((entry) => entry[0] === name);
      const [teacher, location] = teacherAndLocation.split(' · ');
      await classStatement.executeAsync(`class-${index + 1}`, name, teacher, location, grade, color, `${name} course materials and class information.`);
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
  const assignmentRows = await db.getAllAsync<AssignmentRow>('SELECT id, title, subject, teacher, due, progress, status, tone, class_id AS classId, COALESCE(description, \'\') AS description, COALESCE(due_date, due) AS dueDate, COALESCE(submission_types, \'["file"]\') AS submissionTypesJson, grade, feedback FROM assignments ORDER BY COALESCE(due_date, due)');
  const classRows = await db.getAllAsync<SchoolClass>('SELECT id, name, teacher, location, grade, color, COALESCE(description, \'\') AS description FROM classes ORDER BY name');
  const events = await db.getAllAsync<CalendarEvent>('SELECT id, title, event_date AS date, event_time AS time, notes, kind, assignment_id AS assignmentId FROM events ORDER BY event_date, event_time');
  return { assignments: assignmentRows.map(mapAssignment), classes: classRows, event: events[0] ?? null, events };
}

export async function applyServerSnapshot(snapshot: { assignments: Assignment[]; classes: SchoolClass[]; events: CalendarEvent[] }) {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (const item of snapshot.classes) await db.runAsync('INSERT OR REPLACE INTO classes (id, name, teacher, location, grade, color, description) VALUES (?, ?, ?, ?, ?, ?, ?)', item.id, item.name, item.teacher, item.location, item.grade, item.color, item.description);
    for (const item of snapshot.assignments) await db.runAsync('INSERT OR REPLACE INTO assignments (id, title, subject, teacher, due, progress, status, tone, class_id, description, due_date, submission_types, grade, feedback) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', item.id, item.title, item.subject, item.teacher, item.due, item.progress, item.status, item.tone, item.classId, item.description, item.dueDate, JSON.stringify(item.submissionTypes), item.grade, item.feedback);
    for (const item of snapshot.events) await db.runAsync('INSERT OR REPLACE INTO events (id, title, event_date, event_time, notes, kind, assignment_id) VALUES (?, ?, ?, ?, ?, ?, ?)', item.id, item.title, item.date, item.time ?? null, item.notes ?? '', item.kind, item.assignmentId ?? null);
    await db.runAsync('INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)', 'last_sync', new Date().toISOString());
  });
}

type AssignmentRow = Omit<Assignment, 'submissionTypes'> & { submissionTypesJson: string; classId: string | null };

function mapAssignment(row: AssignmentRow): Assignment {
  return { ...row, classId: row.classId ?? '', submissionTypes: JSON.parse(row.submissionTypesJson || '["file"]') as SubmissionType[] };
}

export async function createAssignment(input: Omit<Assignment, 'id' | 'due'> & { id?: string; due?: string }) {
  const id = input.id ?? `assignment-${Date.now()}`;
  const due = input.due ?? `Due ${input.dueDate}`;
  await (await getDatabase()).runAsync('INSERT INTO assignments (id, title, subject, teacher, due, progress, status, tone, class_id, description, due_date, submission_types, grade, feedback) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, input.title, input.subject, input.teacher, due, input.progress, input.status, input.tone, input.classId, input.description, input.dueDate, JSON.stringify(input.submissionTypes), input.grade, input.feedback);
  return id;
}

export async function createClass(input: Omit<SchoolClass, 'id'> & { id?: string }) {
  const id = input.id ?? `class-${Date.now()}`;
  await (await getDatabase()).runAsync('INSERT INTO classes (id, name, teacher, location, grade, color, description) VALUES (?, ?, ?, ?, ?, ?, ?)', id, input.name, input.teacher, input.location, input.grade, input.color, input.description);
  return id;
}

export async function getClassDetail(classId: string) {
  const db = await getDatabase();
  const classRow = await db.getFirstAsync<SchoolClass>('SELECT id, name, teacher, location, grade, color, COALESCE(description, \'\') AS description FROM classes WHERE id = ?', classId);
  const assignmentRows = await db.getAllAsync<AssignmentRow>('SELECT id, title, subject, teacher, due, progress, status, tone, class_id AS classId, COALESCE(description, \'\') AS description, COALESCE(due_date, due) AS dueDate, COALESCE(submission_types, \'["file"]\') AS submissionTypesJson, grade, feedback FROM assignments WHERE class_id = ? ORDER BY COALESCE(due_date, due)', classId);
  const materials = await db.getAllAsync<ClassMaterial>('SELECT id, class_id AS classId, title, type, uri, COALESCE(content, \'\') AS content FROM class_materials WHERE class_id = ? ORDER BY title', classId);
  const quizRows = await db.getAllAsync<Omit<Quiz, 'questions'>>('SELECT id, class_id AS classId, title, description, due_date AS dueDate FROM quizzes WHERE class_id = ? ORDER BY due_date', classId);
  const quizzes = await Promise.all(quizRows.map(async (quiz) => ({ ...quiz, questions: await getQuizQuestions(quiz.id) })));
  return { classRow: classRow ?? null, assignments: assignmentRows.map(mapAssignment), materials, quizzes };
}

async function getQuizQuestions(quizId: string) {
  const rows = await (await getDatabase()).getAllAsync<{ id: string; quizId: string; prompt: string; type: QuizQuestionType; options: string; correctAnswer: string | null; points: number }>('SELECT id, quiz_id AS quizId, prompt, type, options, correct_answer AS correctAnswer, points FROM quiz_questions WHERE quiz_id = ? ORDER BY rowid', quizId);
  return rows.map((row) => ({ ...row, options: JSON.parse(row.options || '[]') as string[] }));
}

export async function createQuiz(input: { id?: string; classId: string; title: string; description: string; dueDate: string; questions: Omit<QuizQuestion, 'id' | 'quizId'>[] }) {
  const id = input.id ?? `quiz-${Date.now()}`;
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('INSERT INTO quizzes (id, class_id, title, description, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, input.classId, input.title, input.description, input.dueDate, new Date().toISOString());
    for (const [index, question] of input.questions.entries()) await db.runAsync('INSERT INTO quiz_questions (id, quiz_id, prompt, type, options, correct_answer, points) VALUES (?, ?, ?, ?, ?, ?, ?)', `${id}-q${index + 1}`, id, question.prompt, question.type, JSON.stringify(question.options), question.correctAnswer, question.points);
  });
  return id;
}

export async function submitQuizAttempt(quiz: Quiz, answers: Record<string, string>) {
  const score = quiz.questions.reduce((total, question) => total + (question.type === 'multiple_choice' && answers[question.id] === question.correctAnswer ? question.points : 0), 0);
  const hasShortAnswer = quiz.questions.some((question) => question.type === 'short_answer');
  const id = `attempt-${Date.now()}`;
  await (await getDatabase()).runAsync('INSERT INTO quiz_attempts (id, quiz_id, answers, score, graded, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, quiz.id, JSON.stringify(answers), hasShortAnswer ? null : score, hasShortAnswer ? 0 : 1, hasShortAnswer ? 'ungraded' : 'graded', new Date().toISOString());
  return { id, score: hasShortAnswer ? null : score, status: hasShortAnswer ? 'ungraded' as const : 'graded' as const };
}

export async function createEvent(input: Omit<CalendarEvent, 'id'> & { id?: string }) {
  const id = input.id ?? `event-${Date.now()}`;
  await (await getDatabase()).runAsync('INSERT INTO events (id, title, event_date, event_time, notes, kind, assignment_id) VALUES (?, ?, ?, ?, ?, ?, ?)', id, input.title, input.date, input.time ?? null, input.notes ?? '', input.kind, input.assignmentId ?? null);
  return id;
}

export async function updateEvent(id: string, input: Omit<CalendarEvent, 'id'>) {
  await (await getDatabase()).runAsync('UPDATE events SET title = ?, event_date = ?, event_time = ?, notes = ?, kind = ?, assignment_id = ? WHERE id = ?', input.title, input.date, input.time ?? null, input.notes ?? '', input.kind, input.assignmentId ?? null, id);
}

export async function createSubmission(input: Omit<Submission, 'id' | 'createdAt' | 'status'> & { id?: string; content?: string | null }) {
  const id = input.id ?? `submission-${Date.now()}`;
  const createdAt = new Date().toISOString();
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('INSERT INTO submissions (id, assignment_id, kind, uri, file_name, mime_type, size, content, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, input.assignmentId, input.kind, input.uri, input.fileName, input.mimeType, input.size ?? null, input.content ?? null, createdAt, 'completed');
    await db.runAsync('UPDATE assignments SET progress = 100, status = ? WHERE id = ?', 'Completed', input.assignmentId);
    await db.runAsync('INSERT OR REPLACE INTO outbox (id, type, payload, created_at) VALUES (?, ?, ?, ?)', `submission-${id}`, 'submission', JSON.stringify({ id, assignmentId: input.assignmentId, kind: input.kind, uri: input.uri, content: input.content ?? null }), createdAt);
  });
  return id;
}

export async function getSubmissions(assignmentId: string) {
  return (await (await getDatabase()).getAllAsync<Submission>('SELECT id, assignment_id AS assignmentId, kind, uri, file_name AS fileName, mime_type AS mimeType, size, created_at AS createdAt, status FROM submissions WHERE assignment_id = ? ORDER BY created_at DESC', assignmentId));
}

export async function deleteEvent(id: string) {
  await (await getDatabase()).runAsync('DELETE FROM events WHERE id = ?', id);
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
