-- LocalLearn authoritative server schema, SQLite 3.
-- Apply transactionally with foreign_keys enabled. API-generated UUIDs are TEXT.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE CHECK (length(username) BETWEEN 1 AND 80),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 160),
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','teacher','administrator')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  section_name TEXT,
  description TEXT NOT NULL DEFAULT '',
  teacher_id TEXT NOT NULL REFERENCES users(id),
  room TEXT,
  term TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_classes_teacher_active ON classes(teacher_id, active);

CREATE TABLE IF NOT EXISTS class_memberships (
  class_id TEXT NOT NULL REFERENCES classes(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  membership_role TEXT NOT NULL CHECK (membership_role IN ('student','teacher')),
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  removed_at TEXT,
  PRIMARY KEY (class_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_memberships_user_active ON class_memberships(user_id, removed_at);

CREATE TABLE IF NOT EXISTS class_meetings (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL REFERENCES classes(id),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL CHECK (ends_at > starts_at),
  effective_from TEXT,
  effective_until TEXT,
  room TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_meetings_class_weekday ON class_meetings(class_id, weekday, active);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL REFERENCES classes(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '',
  due_at TEXT,
  allowed_submission_types TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(allowed_submission_types)),
  allow_late INTEGER NOT NULL DEFAULT 1 CHECK (allow_late IN (0,1)),
  allow_resubmission INTEGER NOT NULL DEFAULT 0 CHECK (allow_resubmission IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_assignments_class_due ON assignments(class_id, due_at);
CREATE INDEX IF NOT EXISTS ix_assignments_creator_updated ON assignments(created_by, updated_at);

CREATE TABLE IF NOT EXISTS assignment_resources (
  id TEXT PRIMARY KEY NOT NULL,
  assignment_id TEXT NOT NULL REFERENCES assignments(id),
  display_name TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256 TEXT NOT NULL CHECK (length(checksum_sha256) = 64),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_assignment_resources_assignment ON assignment_resources(assignment_id);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY NOT NULL,
  assignment_id TEXT NOT NULL REFERENCES assignments(id),
  student_id TEXT NOT NULL REFERENCES users(id),
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','returned','revision_requested','graded')),
  grade_value REAL,
  grade_label TEXT,
  graded_at TEXT,
  graded_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (assignment_id, student_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS ix_submissions_student_status ON submissions(student_id, status, submitted_at);

CREATE TABLE IF NOT EXISTS submission_files (
  id TEXT PRIMARY KEY NOT NULL,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  storage_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256 TEXT NOT NULL CHECK (length(checksum_sha256) = 64),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_submission_files_submission ON submission_files(submission_id);

CREATE TABLE IF NOT EXISTS assignment_feedback (
  id TEXT PRIMARY KEY NOT NULL,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  teacher_id TEXT NOT NULL REFERENCES users(id),
  comment TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_feedback_submission_created ON assignment_feedback(submission_id, created_at);

CREATE TABLE IF NOT EXISTS curriculum_units (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL REFERENCES classes(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL CHECK (position >= 0),
  starts_on TEXT,
  ends_on TEXT,
  learning_objectives TEXT CHECK (learning_objectives IS NULL OR json_valid(learning_objectives)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (class_id, position)
);

CREATE TABLE IF NOT EXISTS curriculum_lessons (
  id TEXT PRIMARY KEY NOT NULL,
  unit_id TEXT NOT NULL REFERENCES curriculum_units(id),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL CHECK (position >= 0),
  estimated_minutes INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes >= 0),
  content_text TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (unit_id, position)
);

CREATE TABLE IF NOT EXISTS quizzes (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL REFERENCES classes(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_at TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_quizzes_class_due ON quizzes(class_id, due_at);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id TEXT PRIMARY KEY NOT NULL,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id),
  position INTEGER NOT NULL CHECK (position >= 0),
  prompt TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('multiple_choice','short_answer')),
  options TEXT CHECK (options IS NULL OR json_valid(options)),
  correct_answer TEXT,
  points REAL NOT NULL DEFAULT 1 CHECK (points >= 0),
  UNIQUE (quiz_id, position)
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id),
  student_id TEXT NOT NULL REFERENCES users(id),
  answers TEXT NOT NULL CHECK (json_valid(answers)),
  score REAL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','ungraded','graded')),
  graded_by TEXT REFERENCES users(id),
  graded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (quiz_id, student_id)
);
CREATE INDEX IF NOT EXISTS ix_quiz_attempts_student ON quiz_attempts(student_id, quiz_id, created_at);
CREATE TRIGGER IF NOT EXISTS quiz_attempts_no_update BEFORE UPDATE ON quiz_attempts
BEGIN SELECT RAISE(ABORT, 'quiz attempts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS quiz_attempts_no_delete BEFORE DELETE ON quiz_attempts
BEGIN SELECT RAISE(ABORT, 'quiz attempts are immutable'); END;

CREATE TABLE IF NOT EXISTS learning_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  student_id TEXT NOT NULL REFERENCES users(id),
  lesson_id TEXT NOT NULL REFERENCES curriculum_lessons(id),
  due_at TEXT NOT NULL,
  completed_at TEXT,
  recall_rating INTEGER CHECK (recall_rating IS NULL OR recall_rating BETWEEN 1 AND 5),
  interval_days INTEGER NOT NULL DEFAULT 1 CHECK (interval_days >= 1),
  source TEXT NOT NULL DEFAULT 'lesson' CHECK (source IN ('lesson','quiz','teacher')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_reviews_student_due ON learning_reviews(student_id, completed_at, due_at);
CREATE INDEX IF NOT EXISTS ix_reviews_lesson ON learning_reviews(lesson_id, student_id);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT REFERENCES classes(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('assignment','class','school','holiday','reminder')),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  assignment_id TEXT REFERENCES assignments(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_events_class_start ON calendar_events(class_id, starts_at);

CREATE TABLE IF NOT EXISTS class_materials (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL REFERENCES classes(id),
  title TEXT NOT NULL,
  material_type TEXT NOT NULL CHECK (material_type IN ('syllabus','textbook','resource')),
  storage_key TEXT,
  content_text TEXT,
  mime_type TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_materials_class ON class_materials(class_id, material_type);

CREATE TABLE IF NOT EXISTS learner_portfolio_items (
  id TEXT PRIMARY KEY NOT NULL,
  learner_id TEXT NOT NULL REFERENCES users(id),
  item_type TEXT NOT NULL CHECK (item_type IN ('learning_record','work_sample','credential','reflection')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  content_json TEXT CHECK (content_json IS NULL OR json_valid(content_json)),
  storage_key TEXT,
  source_class_id TEXT REFERENCES classes(id),
  achieved_at TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','shareable')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_portfolio_learner_time ON learner_portfolio_items(learner_id, achieved_at);

CREATE TABLE IF NOT EXISTS learner_transfer_codes (
  id TEXT PRIMARY KEY NOT NULL,
  learner_id TEXT NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL CHECK (length(code_hash) = 64),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_transfer_learner_expiry ON learner_transfer_codes(learner_id, expires_at, used_at);

CREATE TABLE IF NOT EXISTS sync_operations (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  operation_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_sync_user_created ON sync_operations(user_id, created_at);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO schema_migrations(version) VALUES ('001_initial_schema');
