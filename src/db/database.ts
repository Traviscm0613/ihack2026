import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import nacl from 'tweetnacl';
import { assignments as seedAssignments, classes as seedClasses, type Assignment, type SubmissionType } from '../data/mockData';

export type SchoolClass = { id: string; name: string; sectionName: string | null; teacher: string; location: string; grade: string; color: 'purple' | 'blue' | 'green' | 'orange'; description: string };
export type ClassMaterial = { id: string; classId: string; title: string; type: 'syllabus' | 'textbook' | 'resource'; uri: string | null; content: string };
export type QuizQuestionType = 'multiple_choice' | 'short_answer';
export type QuizQuestion = { id: string; quizId: string; prompt: string; type: QuizQuestionType; options: string[]; correctAnswer: string | null; points: number };
export type Quiz = { id: string; classId: string; title: string; description: string; dueDate: string; questions: QuizQuestion[] };
export type CalendarEvent = { id: string; title: string; date: string; time?: string; notes?: string; kind: 'assignment' | 'class' | 'school'; assignmentId?: string; localOnly?: boolean };
export type DashboardData = { assignments: Assignment[]; classes: SchoolClass[]; event: CalendarEvent | null; events: CalendarEvent[]; quizzes: Quiz[]; completedQuizIds: string[] };
export type Submission = { id: string; assignmentId: string; kind: SubmissionType; uri: string; fileName: string; mimeType: string; size: number | null; createdAt: string; status: 'completed' | 'pending' };
export type QuizAttempt = { id: string; quizId: string; score: number | null; status: 'awaiting_feedback' | 'graded' | 'ungraded'; submittedAt: string };
export type LocalUser = { id: string; username: string; displayName: string; role: 'student' | 'teacher' | 'administrator'; active: boolean };
export type RosterMember = LocalUser & { membershipRole: 'student' | 'teacher' };
export type TeacherReview = { submission: Submission; studentName: string; assignmentTitle: string; feedback: string | null; grade: number | null };

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
    CREATE TRIGGER IF NOT EXISTS quiz_attempts_immutable_update BEFORE UPDATE ON quiz_attempts BEGIN SELECT RAISE(ABORT, 'Quiz attempts cannot be edited'); END;
    CREATE TRIGGER IF NOT EXISTS quiz_attempts_immutable_delete BEFORE DELETE ON quiz_attempts BEGIN SELECT RAISE(ABORT, 'Quiz attempts cannot be deleted'); END;
  `);

  await ensureAssignmentColumns(db);
  await ensureClassColumns(db);
  await ensureSubmissionColumns(db);
  await ensureMaterialColumns(db);
  await ensureEventColumns(db);
  await ensureQuizAttemptColumns(db);

  if (process.env.NODE_ENV !== 'production') await seedDatabase(db);
  await seedLocalUsers(db);
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
  const assignments = await db.getAllAsync<{ id: string; title: string; dueDate: string; description: string }>("SELECT id, title, COALESCE(due_date, due) AS dueDate, COALESCE(description, '') AS description FROM assignments WHERE due_date IS NOT NULL OR due IS NOT NULL");
  for (const assignment of assignments) {
    const eventDate = assignment.dueDate.replace(/^Due\s+/i, '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) continue;
    const existing = await db.getFirstAsync<{ id: string }>('SELECT id FROM events WHERE assignment_id = ? LIMIT 1', assignment.id);
    if (existing) continue;
    await db.runAsync('INSERT OR IGNORE INTO events (id, title, event_date, event_time, notes, kind, assignment_id) VALUES (?, ?, ?, ?, ?, ?, ?)', `assignment-event-${assignment.id}`, assignment.title, eventDate, null, assignment.description, 'assignment', assignment.id);
  }
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
  ];
  for (const [name, definition] of additions) {
    if (!existing.has(name)) await db.execAsync(`ALTER TABLE assignments ADD COLUMN ${name} ${definition}`);
  }
}

async function ensureClassColumns(db: SQLiteDatabase) {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(classes)');
  if (!columns.some((column) => column.name === 'section_name')) await db.execAsync('ALTER TABLE classes ADD COLUMN section_name TEXT');
  if (!columns.some((column) => column.name === 'description')) await db.execAsync("ALTER TABLE classes ADD COLUMN description TEXT NOT NULL DEFAULT ''");
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
  const assignmentRows = await db.getAllAsync<AssignmentRow>('SELECT id, title, subject, teacher, due, completed AS completedValue, tone, class_id AS classId, COALESCE(description, \'\') AS description, COALESCE(due_date, due) AS dueDate, COALESCE(submission_types, \'["file"]\') AS submissionTypesJson, grade, feedback FROM assignments ORDER BY COALESCE(due_date, due)');
  const classRows = await db.getAllAsync<SchoolClass>('SELECT id, name, section_name AS sectionName, teacher, location, grade, color, COALESCE(description, \'\') AS description FROM classes ORDER BY name');
  const eventRows = await db.getAllAsync<CalendarEventRow>('SELECT id, title, event_date AS date, event_time AS time, notes, kind, assignment_id AS assignmentId, local_only AS localOnlyValue FROM events ORDER BY event_date, event_time');
  const events = eventRows.map(mapCalendarEvent);
  const quizRows = await db.getAllAsync<Omit<Quiz, 'questions'>>('SELECT id, class_id AS classId, title, description, due_date AS dueDate FROM quizzes ORDER BY due_date');
  const quizzes = await Promise.all(quizRows.map(async (quiz) => ({ ...quiz, questions: await getQuizQuestions(quiz.id) })));
  const completedQuizRows = await db.getAllAsync<{ quizId: string }>('SELECT quiz_id AS quizId FROM quiz_attempts');
  return { assignments: assignmentRows.map(mapAssignment), classes: classRows, event: events[0] ?? null, events, quizzes, completedQuizIds: completedQuizRows.map((row) => row.quizId) };
}

export async function applyServerSnapshot(snapshot: { assignments: Assignment[]; classes: SchoolClass[]; events: CalendarEvent[] }) {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (const item of snapshot.classes) await db.runAsync('INSERT OR REPLACE INTO classes (id, name, section_name, teacher, location, grade, color, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', item.id, item.name, item.sectionName ?? null, item.teacher, item.location, item.grade, item.color, item.description);
    for (const item of snapshot.assignments) await db.runAsync('INSERT OR REPLACE INTO assignments (id, title, subject, teacher, due, progress, status, completed, tone, class_id, description, due_date, submission_types, grade, feedback) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', item.id, item.title, item.subject, item.teacher, item.due, item.completed ? 100 : 0, item.completed ? 'Completed' : 'In progress', item.completed ? 1 : 0, item.tone, item.classId, item.description, item.dueDate, JSON.stringify(item.submissionTypes), item.grade, item.feedback);
    await syncAssignmentEvents(db);
    for (const item of snapshot.events) await db.runAsync('INSERT OR REPLACE INTO events (id, title, event_date, event_time, notes, kind, assignment_id, local_only) VALUES (?, ?, ?, ?, ?, ?, ?, 0)', item.id, item.title, item.date, item.time ?? null, item.notes ?? '', item.kind, item.assignmentId ?? null);
    await db.runAsync('INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)', 'last_sync', new Date().toISOString());
  });
}

type AssignmentRow = Omit<Assignment, 'submissionTypes' | 'completed'> & { submissionTypesJson: string; classId: string | null; completedValue: number };
type CalendarEventRow = Omit<CalendarEvent, 'localOnly'> & { localOnlyValue: number };

function mapCalendarEvent(row: CalendarEventRow): CalendarEvent {
  return { ...row, localOnly: row.localOnlyValue === 1 };
}

function mapAssignment(row: AssignmentRow): Assignment {
  return { ...row, completed: row.completedValue === 1, classId: row.classId ?? '', submissionTypes: JSON.parse(row.submissionTypesJson || '["file"]') as SubmissionType[] };
}

export async function createAssignment(input: Omit<Assignment, 'id' | 'due'> & { id?: string; due?: string }) {
  const id = input.id ?? `assignment-${Date.now()}`;
  const due = input.due ?? `Due ${input.dueDate}`;
  await (await getDatabase()).runAsync('INSERT INTO assignments (id, title, subject, teacher, due, progress, status, completed, tone, class_id, description, due_date, submission_types, grade, feedback) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, input.title, input.subject, input.teacher, due, input.completed ? 100 : 0, input.completed ? 'Completed' : 'In progress', input.completed ? 1 : 0, input.tone, input.classId, input.description, input.dueDate, JSON.stringify(input.submissionTypes), input.grade, input.feedback);
  await (await getDatabase()).runAsync('INSERT OR REPLACE INTO events (id, title, event_date, event_time, notes, kind, assignment_id) VALUES (?, ?, ?, ?, ?, ?, ?)', `assignment-event-${id}`, input.title, input.dueDate, null, input.description, 'assignment', id);
  return id;
}

export async function createClass(input: Omit<SchoolClass, 'id'> & { id?: string }) {
  const id = input.id ?? `class-${Date.now()}`;
  await (await getDatabase()).runAsync('INSERT INTO classes (id, name, section_name, teacher, location, grade, color, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, input.name, input.sectionName ?? null, input.teacher, input.location, input.grade, input.color, input.description);
  return id;
}

export async function getClassDetail(classId: string) {
  const db = await getDatabase();
  const classRow = await db.getFirstAsync<SchoolClass>('SELECT id, name, section_name AS sectionName, teacher, location, grade, color, COALESCE(description, \'\') AS description FROM classes WHERE id = ?', classId);
  const assignmentRows = await db.getAllAsync<AssignmentRow>('SELECT id, title, subject, teacher, due, completed AS completedValue, tone, class_id AS classId, COALESCE(description, \'\') AS description, COALESCE(due_date, due) AS dueDate, COALESCE(submission_types, \'["file"]\') AS submissionTypesJson, grade, feedback FROM assignments WHERE class_id = ? ORDER BY COALESCE(due_date, due)', classId);
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

function bytesToBase64(bytes: Uint8Array) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += alphabet[first >> 2];
    output += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    output += second === undefined ? '=' : alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)];
    output += third === undefined ? '=' : alphabet[third & 63];
  }
  return output;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const quizStorageKey = nacl.hash(new TextEncoder().encode('LocalLearn quiz attempt key')).slice(0, nacl.secretbox.keyLength);

export async function getQuizAttempt(quizId: string) {
  return (await (await getDatabase()).getFirstAsync<QuizAttempt>('SELECT id, quiz_id AS quizId, score, status, created_at AS submittedAt FROM quiz_attempts WHERE quiz_id = ? ORDER BY rowid LIMIT 1', quizId)) ?? null;
}

export async function submitQuizAttempt(quiz: Quiz, answers: Record<string, string>) {
  const existing = await getQuizAttempt(quiz.id);
  if (existing) return { ...existing, alreadySubmitted: true as const };
  const score = quiz.questions.reduce((total, question) => total + (question.type === 'multiple_choice' && answers[question.id] === question.correctAnswer ? question.points : 0), 0);
  const hasShortAnswer = quiz.questions.some((question) => question.type === 'short_answer');
  const id = `attempt-${Date.now()}`;
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const encryptedAnswers = nacl.secretbox(new TextEncoder().encode(JSON.stringify(answers)), nonce, quizStorageKey);
  const encrypted = bytesToBase64(encryptedAnswers);
  const nonceValue = bytesToBase64(nonce);
  const integrityHash = bytesToHex(nacl.hash(new TextEncoder().encode(`${id}:${quiz.id}:${nonceValue}:${encrypted}`)));
  const submittedAt = new Date().toISOString();
  const db = await getDatabase();
  await db.runAsync('INSERT INTO quiz_attempts (id, quiz_id, answers, encrypted_answers, nonce, integrity_hash, score, graded, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, quiz.id, 'ENCRYPTED', encrypted, nonceValue, integrityHash, hasShortAnswer ? null : score, 0, 'awaiting_feedback', submittedAt);
  return { id, quizId: quiz.id, score: hasShortAnswer ? null : score, status: 'awaiting_feedback' as const, submittedAt, alreadySubmitted: false as const };
}

export async function createEvent(input: Omit<CalendarEvent, 'id'> & { id?: string }) {
  const id = input.id ?? `event-${Date.now()}`;
  await (await getDatabase()).runAsync('INSERT INTO events (id, title, event_date, event_time, notes, kind, assignment_id, local_only) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, input.title, input.date, input.time ?? null, input.notes ?? '', input.kind, input.assignmentId ?? null, input.localOnly ? 1 : 0);
  return id;
}

export async function updateEvent(id: string, input: Omit<CalendarEvent, 'id'>) {
  await (await getDatabase()).runAsync('UPDATE events SET title = ?, event_date = ?, event_time = ?, notes = ?, kind = ?, assignment_id = ? WHERE id = ? AND local_only = 1', input.title, input.date, input.time ?? null, input.notes ?? '', input.kind, input.assignmentId ?? null, id);
}

export async function createSubmission(input: Omit<Submission, 'id' | 'createdAt' | 'status'> & { id?: string; content?: string | null }) {
  const id = input.id ?? `submission-${Date.now()}`;
  const createdAt = new Date().toISOString();
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('INSERT INTO submissions (id, assignment_id, kind, uri, file_name, mime_type, size, content, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, input.assignmentId, input.kind, input.uri, input.fileName, input.mimeType, input.size ?? null, input.content ?? null, createdAt, 'completed');
    await db.runAsync('UPDATE assignments SET completed = 1, progress = 100, status = ? WHERE id = ?', 'Completed', input.assignmentId);
    await db.runAsync('INSERT OR REPLACE INTO outbox (id, type, payload, created_at) VALUES (?, ?, ?, ?)', `submission-${id}`, 'submission', JSON.stringify({ id, assignmentId: input.assignmentId, kind: input.kind, uri: input.uri, content: input.content ?? null }), createdAt);
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
  await db.runAsync('INSERT OR REPLACE INTO outbox (id, type, payload, created_at) VALUES (?, ?, ?, ?)', `completion-${id}`, 'assignment-completion', JSON.stringify({ id, completed }), new Date().toISOString());
}

export async function getPendingChangeCount() {
  return (await (await getDatabase()).getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM outbox'))?.count ?? 0;
}

export async function enqueuePendingChange(change: { id: string; type: string; payload: Record<string, string | number | boolean>; createdAt: string }) {
  await (await getDatabase()).runAsync('INSERT OR REPLACE INTO outbox (id, type, payload, created_at) VALUES (?, ?, ?, ?)', change.id, change.type, JSON.stringify(change.payload), change.createdAt);
}

export async function clearPendingChanges() {
  await (await getDatabase()).runAsync('DELETE FROM outbox');
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
  const rows = await (await getDatabase()).getAllAsync<Submission & { studentName: string; assignmentTitle: string; grade: number | null; feedback: string | null }>("SELECT s.id, s.assignment_id AS assignmentId, s.kind, s.uri, s.file_name AS fileName, s.mime_type AS mimeType, s.size, s.created_at AS createdAt, s.status, COALESCE(u.display_name, 'Student') AS studentName, a.title AS assignmentTitle, a.grade, a.feedback FROM submissions s JOIN assignments a ON a.id = s.assignment_id LEFT JOIN users u ON u.role = 'student' ORDER BY s.created_at DESC");
  return rows.map((row) => ({ submission: row, studentName: row.studentName, assignmentTitle: row.assignmentTitle, feedback: row.feedback, grade: row.grade }));
}

export async function saveGrade(assignmentId: string, grade: number | null, feedback: string, status: 'graded' | 'returned' | 'revision_requested') {
  const db = await getDatabase();
  await db.runAsync('UPDATE assignments SET grade = ?, feedback = ?, status = ? WHERE id = ?', grade, feedback, status, assignmentId);
  await db.runAsync('INSERT OR REPLACE INTO outbox (id, type, payload, created_at) VALUES (?, ?, ?, ?)', `grade-${assignmentId}`, 'grade', JSON.stringify({ assignmentId, grade, feedback, status }), new Date().toISOString());
}
