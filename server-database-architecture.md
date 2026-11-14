# Raspberry Pi Server Database Architecture

This document defines the database architecture for the LocalLearn server running on a Raspberry Pi. The server database is the authoritative source for school users, classes, assignments, submissions, quizzes, grades, feedback, calendar events, and class materials.

The React Native client must not connect directly to MySQL. Clients communicate with the local API over the school Wi-Fi. Each client may maintain a local SQLite cache and an outbox for offline work, but the Raspberry Pi server is authoritative after synchronization.

## Technology

- Database: MySQL 8.x
- Host: Raspberry Pi on the school’s local network
- API: Local HTTP API hosted on the Raspberry Pi
- File storage: A local server directory or attached storage device
- Backups: MySQL logical backups plus a separate copy of uploaded files
- Network: LAN-only by default; internet access is not required

The exact Raspberry Pi model, MySQL version, storage device, expected user count, and simultaneous-user target remain deployment parameters and should be recorded before production installation.

## Design principles

1. MySQL is the server source of truth.
2. The API is the only component allowed to modify MySQL.
3. Uploaded files are stored outside MySQL and referenced by database rows.
4. Every client mutation has a stable client-generated ID for safe retry.
5. Server writes should be idempotent where possible.
6. Deleting records should be avoided when a soft-delete or archival state is sufficient.
7. Schema changes must use numbered migrations.
8. Backups must be usable without internet access.

## Core entities

```text
users ──< class_memberships >── classes
classes ──< assignments
classes ──< quizzes ──< quiz_questions
assignments ──< submissions ──< submission_files
assignments ──< assignment_feedback
classes ──< calendar_events
classes ──< class_materials
users ──< sync_operations
```

## Tables

### `users`

Stores student, teacher, and administrator accounts.

| Column | Type | Notes |
|---|---|---|
| `id` | `CHAR(36)` | UUID primary key |
| `username` | `VARCHAR(80)` | Unique within the school |
| `display_name` | `VARCHAR(160)` | Name shown in the app |
| `password_hash` | `VARCHAR(255)` | Never store plaintext passwords |
| `role` | `ENUM` | `student`, `teacher`, `administrator` |
| `active` | `BOOLEAN` | Account access flag |
| `created_at` | `DATETIME(6)` | Server timestamp |
| `updated_at` | `DATETIME(6)` | Server timestamp |

### `classes`

Stores classes managed by teachers.

| Column | Type | Notes |
|---|---|---|
| `id` | `CHAR(36)` | UUID primary key |
| `name` | `VARCHAR(160)` | Class name |
| `description` | `TEXT` | Class overview |
| `teacher_id` | `CHAR(36)` | Foreign key to `users` |
| `room` | `VARCHAR(80)` | Optional physical location |
| `term` | `VARCHAR(80)` | Semester or school term |
| `active` | `BOOLEAN` | Whether the class is currently offered |
| `created_at` | `DATETIME(6)` | Server timestamp |
| `updated_at` | `DATETIME(6)` | Server timestamp |

### `class_memberships`

Maps students to classes.

| Column | Type | Notes |
|---|---|---|
| `class_id` | `CHAR(36)` | Foreign key to `classes` |
| `user_id` | `CHAR(36)` | Foreign key to `users` |
| `membership_role` | `ENUM` | `student`, `teacher` |
| `joined_at` | `DATETIME(6)` | Enrollment timestamp |
| `removed_at` | `DATETIME(6)` | Nullable; supports historical records |

Primary key: (`class_id`, `user_id`).

### `assignments`

Stores assignment instructions and submission rules.

| Column | Type | Notes |
|---|---|---|
| `id` | `CHAR(36)` | UUID primary key |
| `class_id` | `CHAR(36)` | Foreign key to `classes` |
| `created_by` | `CHAR(36)` | Teacher user ID |
| `title` | `VARCHAR(200)` | Assignment title |
| `description` | `TEXT` | Instructions |
| `due_at` | `DATETIME(6)` | Due date and optional time |
| `allowed_submission_types` | `JSON` | `file`, `photo`, `scan` initially |
| `allow_late` | `BOOLEAN` | Late submission policy |
| `allow_resubmission` | `BOOLEAN` | Revision policy |
| `active` | `BOOLEAN` | Hides an assignment without deleting it |
| `created_at` | `DATETIME(6)` | Server timestamp |
| `updated_at` | `DATETIME(6)` | Server timestamp |

Recommended indexes:

- (`class_id`, `due_at`)
- (`created_by`, `updated_at`)

### `assignment_resources`

References teacher-provided files attached to an assignment.

| Column | Type | Notes |
|---|---|---|
| `id` | `CHAR(36)` | UUID primary key |
| `assignment_id` | `CHAR(36)` | Foreign key to `assignments` |
| `display_name` | `VARCHAR(255)` | Name shown to users |
| `storage_key` | `VARCHAR(500)` | Relative path or generated storage key |
| `mime_type` | `VARCHAR(120)` | File MIME type |
| `size_bytes` | `BIGINT UNSIGNED` | File size |
| `checksum_sha256` | `CHAR(64)` | Integrity and deduplication |
| `created_at` | `DATETIME(6)` | Server timestamp |

### `submissions`

Represents a student’s submission attempt. A submission is not considered server-submitted until this row is created successfully.

| Column | Type | Notes |
|---|---|---|
| `id` | `CHAR(36)` | Stable client or server UUID |
| `assignment_id` | `CHAR(36)` | Foreign key to `assignments` |
| `student_id` | `CHAR(36)` | Foreign key to `users` |
| `attempt_number` | `INT UNSIGNED` | Starts at 1 |
| `submitted_at` | `DATETIME(6)` | Server receipt time |
| `status` | `ENUM` | `submitted`, `returned`, `revision_requested`, `graded` |
| `grade_value` | `DECIMAL(6,2)` | Nullable numeric grade |
| `grade_label` | `VARCHAR(40)` | Optional letter or custom label |
| `graded_at` | `DATETIME(6)` | Nullable |
| `graded_by` | `CHAR(36)` | Nullable teacher user ID |
| `created_at` | `DATETIME(6)` | Server timestamp |
| `updated_at` | `DATETIME(6)` | Server timestamp |

Unique key: (`assignment_id`, `student_id`, `attempt_number`).

### `submission_files`

References files uploaded for a submission.

| Column | Type | Notes |
|---|---|---|
| `id` | `CHAR(36)` | UUID primary key |
| `submission_id` | `CHAR(36)` | Foreign key to `submissions` |
| `storage_key` | `VARCHAR(500)` | Relative file storage key |
| `original_name` | `VARCHAR(255)` | Original client filename |
| `mime_type` | `VARCHAR(120)` | File MIME type |
| `size_bytes` | `BIGINT UNSIGNED` | File size |
| `checksum_sha256` | `CHAR(64)` | Integrity check |
| `created_at` | `DATETIME(6)` | Server timestamp |

### `assignment_feedback`

Stores written teacher comments separately from the submission record so feedback history can be preserved.

| Column | Type | Notes |
|---|---|---|
| `id` | `CHAR(36)` | UUID primary key |
| `submission_id` | `CHAR(36)` | Foreign key to `submissions` |
| `teacher_id` | `CHAR(36)` | Foreign key to `users` |
| `comment` | `TEXT` | Written feedback |
| `created_at` | `DATETIME(6)` | Server timestamp |

### `quizzes`

Stores quiz metadata attached to a class.

| Column | Type | Notes |
|---|---|---|
| `id` | `CHAR(36)` | UUID primary key |
| `class_id` | `CHAR(36)` | Foreign key to `classes` |
| `created_by` | `CHAR(36)` | Teacher user ID |
| `title` | `VARCHAR(200)` | Quiz title |
| `description` | `TEXT` | Instructions |
| `due_at` | `DATETIME(6)` | Nullable due date |
| `active` | `BOOLEAN` | Availability flag |
| `created_at` | `DATETIME(6)` | Server timestamp |
| `updated_at` | `DATETIME(6)` | Server timestamp |

### `quiz_questions`

Stores quiz questions in display order.

| Column | Type | Notes |
|---|---|---|
| `id` | `CHAR(36)` | UUID primary key |
| `quiz_id` | `CHAR(36)` | Foreign key to `quizzes` |
| `position` | `INT UNSIGNED` | Display order |
| `prompt` | `TEXT` | Question text |
| `question_type` | `ENUM` | `multiple_choice`, `short_answer` |
| `options` | `JSON` | Multiple-choice options |
| `correct_answer` | `TEXT` | Nullable; never expose to students before submission |
| `points` | `DECIMAL(6,2)` | Maximum points |

Short-answer questions should not receive an automatic grade. The API should mark attempts containing short-answer questions as `ungraded` until a teacher reviews them.

### `quiz_attempts`

Stores a student’s quiz response and grading state.

| Column | Type | Notes |
|---|---|---|
| `id` | `CHAR(36)` | UUID primary key |
| `quiz_id` | `CHAR(36)` | Foreign key to `quizzes` |
| `student_id` | `CHAR(36)` | Foreign key to `users` |
| `answers` | `JSON` | Question ID to submitted answer |
| `score` | `DECIMAL(6,2)` | Nullable while ungraded |
| `status` | `ENUM` | `submitted`, `ungraded`, `graded` |
| `graded_by` | `CHAR(36)` | Nullable teacher user ID |
| `graded_at` | `DATETIME(6)` | Nullable |
| `created_at` | `DATETIME(6)` | Server timestamp |
| `updated_at` | `DATETIME(6)` | Server timestamp |

### `calendar_events`

Stores assignment deadlines, class events, school events, holidays, and reminders.

| Column | Type | Notes |
|---|---|---|
| `id` | `CHAR(36)` | UUID primary key |
| `class_id` | `CHAR(36)` | Nullable for school-wide events |
| `created_by` | `CHAR(36)` | User who created the event |
| `title` | `VARCHAR(200)` | Event title |
| `description` | `TEXT` | Optional details |
| `event_type` | `ENUM` | `assignment`, `class`, `school`, `holiday`, `reminder` |
| `starts_at` | `DATETIME(6)` | Start time |
| `ends_at` | `DATETIME(6)` | Nullable |
| `assignment_id` | `CHAR(36)` | Nullable linked assignment |
| `created_at` | `DATETIME(6)` | Server timestamp |

### `class_materials`

Stores syllabus, textbook, and other class resource references.

| Column | Type | Notes |
|---|---|---|
| `id` | `CHAR(36)` | UUID primary key |
| `class_id` | `CHAR(36)` | Foreign key to `classes` |
| `title` | `VARCHAR(200)` | Material title |
| `material_type` | `ENUM` | `syllabus`, `textbook`, `resource` |
| `storage_key` | `VARCHAR(500)` | Nullable file reference |
| `content_text` | `LONGTEXT` | Optional extracted or authored text |
| `mime_type` | `VARCHAR(120)` | Nullable |
| `created_at` | `DATETIME(6)` | Server timestamp |
| `updated_at` | `DATETIME(6)` | Server timestamp |

The client should open text materials in an in-app reader. File-backed materials should be downloaded through an authenticated API endpoint before opening them locally.

### `sync_operations`

Tracks client mutations and idempotency keys.

| Column | Type | Notes |
|---|---|---|
| `id` | `CHAR(36)` | Client-generated operation ID |
| `user_id` | `CHAR(36)` | Authenticated user |
| `operation_type` | `VARCHAR(80)` | For example `submission.create` |
| `entity_id` | `CHAR(36)` | Affected record |
| `payload_hash` | `CHAR(64)` | Detects conflicting retries |
| `processed_at` | `DATETIME(6)` | Nullable until applied |
| `created_at` | `DATETIME(6)` | Server timestamp |

Primary key: `id`. The API should return the same result when an already-processed operation ID is retried.

## API boundary

The initial client synchronization endpoint can expose a snapshot such as:

```text
GET /api/snapshot
```

The response should contain only data visible to the authenticated user:

```json
{
  "assignments": [],
  "classes": [],
  "events": [],
  "quizzes": [],
  "materials": [],
  "serverTime": "2026-11-13T19:00:00.000Z"
}
```

Client mutations should use explicit endpoints, for example:

- `POST /api/submissions`
- `POST /api/submissions/{id}/files`
- `POST /api/quiz-attempts`
- `POST /api/sync/operations`

The server should authenticate every request, authorize access by role and class membership, validate file sizes and MIME types, and write the database record only after the uploaded file is safely stored.

## File storage

MySQL stores metadata, not uploaded file contents. Files should be stored below a configured application data directory, for example:

```text
/srv/locallearn/data/files/{entity}/{uuid}
```

The database stores the generated `storage_key`, original filename, MIME type, byte size, and SHA-256 checksum. User-provided filenames must never become raw filesystem paths.

## Backups and recovery

The server should create:

1. A daily MySQL dump using a consistent dump process.
2. A matching backup of the file-storage directory.
3. A backup manifest containing database dump name, file archive name, timestamp, and checksum.
4. At least one copy on an external USB drive or other storage device.

Backups should be tested by restoring them to a separate MySQL database and checking that file checksums match the manifest. The Raspberry Pi’s SD card should not be treated as the only copy of student records.

## Security and operations

- Use a dedicated MySQL application user with only required database privileges.
- Do not expose MySQL directly to the school Wi-Fi.
- Bind the API to the Raspberry Pi’s local network interface and use API authentication.
- Hash passwords with a modern password-hashing algorithm.
- Validate authorization on the server even when a client supplies a class or user ID.
- Limit upload size and reject unexpected MIME types.
- Log authentication failures, permission failures, synchronization conflicts, and backup results.
- Keep server time consistent because due dates, receipts, and grading timestamps depend on it.

## Initial parameters to decide

- Raspberry Pi model and available RAM
- MySQL version and installation method
- Expected number of simultaneous clients
- Maximum assignment file size
- Maximum total storage size
- Backup frequency and retention period
- Whether HTTPS certificates are required on the local network
- Whether usernames are school-wide unique
- Whether late submissions are allowed by default
- Whether the API should expose full snapshots or incremental sync only
- Whether class materials require file preview, download, or both

These parameters should be updated in this document as deployment decisions are made.
