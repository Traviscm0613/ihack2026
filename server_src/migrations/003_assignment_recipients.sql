ALTER TABLE classes ADD COLUMN section_name TEXT;
CREATE TABLE IF NOT EXISTS assignment_recipients (
  assignment_id TEXT NOT NULL REFERENCES assignments(id),
  student_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (assignment_id, student_id)
);
