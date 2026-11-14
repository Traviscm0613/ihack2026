# Raspberry Pi Server and Database Architecture

This document defines the LocalLearn server on the Raspberry Pi. SQLite is used by both the server and the Expo client, but each device has its own database: the Pi database is authoritative and each client database is a cache, offline work area, and outbox. Clients must never open or share the Pi's database file. All server data access goes through the local API.

<<<<<<< HEAD
## Technology and deployment
=======
The React Native client must not connect directly to SQLite. Clients communicate with the local API over the school Wi-Fi. Each client may maintain a local SQLite cache and an outbox for offline work, but the Raspberry Pi server is authoritative after synchronization.
>>>>>>> bdb58b778f911779bb72d693142aa250a9eacb5e

- Database: SQLite 3, using the operating system's SQLite library.
- API: Node.js service on the Raspberry Pi, on a dedicated port (the current deployment plan reserves 8090).
- File storage: generated paths under `/srv/locallearn/data/files/` (or a configured data directory).
- Backups: SQLite online backup or `VACUUM INTO`, plus a matching archive of uploaded files and a manifest.
- Network: available on the LocalLearn LAN without internet; preserve the existing gallery and gameboard services.

<<<<<<< HEAD
The server should open one database connection/pool, enable `PRAGMA foreign_keys = ON` on every connection, use WAL mode for concurrent readers, set a busy timeout, and use parameterized queries and transactions. Store timestamps as UTC ISO-8601 text and UUIDs as text. SQLite has no dedicated enum, datetime, or JSON column types: use `TEXT`, `INTEGER` (0/1 booleans), and JSON encoded as `TEXT` with `json_valid` checks where supported. Use `CHECK` constraints for role/status values. Apply numbered migrations transactionally and record them in `schema_migrations`.

## Design principles

1. The Pi's SQLite database is the server source of truth; the API is its only application interface.
2. The client has a separate SQLite cache/outbox and remains useful when disconnected.
3. Stable client-generated operation IDs make retries idempotent.
4. Use transactions for multi-row changes such as grading plus feedback, enrollment, and sync operations.
5. Prefer archival/active flags over destructive deletion where records must be retained.
6. Store uploaded file bytes outside SQLite and keep only generated storage keys and metadata in tables.
7. Keep schema changes in ordered migrations; take a verified backup before upgrades.
=======
- Database: SQLite 3 (Python standard library `sqlite3`)
- Host: Raspberry Pi on the school’s local network
- API: Local HTTP API hosted on the Raspberry Pi
- File storage: A local server directory or attached storage device
- Backups: SQLite database copy plus a separate copy of uploaded files
- Network: LAN-only by default; internet access is not required

The exact Raspberry Pi model, Python/SQLite version, storage device, expected user count, and simultaneous-user target remain deployment parameters and should be recorded before production installation.

## Design principles

1. SQLite is the server source of truth.
2. The API is the only component allowed to modify SQLite.
3. Uploaded files are stored outside SQLite and referenced by database rows.
4. Every client mutation has a stable client-generated ID for safe retry.
5. Server writes should be idempotent where possible.
6. Deleting records should be avoided when a soft-delete or archival state is sufficient.
7. Schema changes must use numbered migrations.
8. Backups must be usable without internet access.
>>>>>>> bdb58b778f911779bb72d693142aa250a9eacb5e

## Schema

The canonical first migration is [`migrations/001_initial_schema.sql`](migrations/001_initial_schema.sql). It covers users, classes and memberships, timetable, assignments and resources, submissions and files, feedback, curriculum units and lessons, quizzes and attempts, spaced-learning reviews, calendar events, class materials, learner portfolio and transfer codes, sync idempotency records, and migration tracking.

Use UUID text primary keys. Enforce roles, status values, weekday ranges, nonnegative sizes/points, and valid relationships with `CHECK`, `UNIQUE`, and foreign keys. Quiz attempts are one per student per quiz in the current client flow, immutable once submitted, and need an API/database constraint for that rule. Never return `correct_answer` to a student before submission. Student-created personal calendar events remain on the client only.

SQLite's flexible typing means the API must validate input lengths, numeric ranges, enum values, and JSON shape before writes. Keep foreign keys enabled and use `ON DELETE` behavior deliberately; use soft deactivation for accounts/classes.

## API responsibilities and demo scope

The client contract is defined in `src/services/serverApi.ts` and summarized in `IMPLEMENTED_ARCHITECTURE.md`. Implement these in a usable order:

1. `GET /api/health` (public connectivity check) and `POST /api/auth/login`, `POST /api/auth/logout` with password hashing and expiring bearer sessions.
2. `GET /api/snapshot`, scoped to the authenticated user's role and class memberships. Return the exact client shape: `assignments`, `classes`, and `events` (plus optional server time only after updating the client type).
3. `POST /api/sync/operations`, transactionally recording stable operation IDs and returning accepted/rejected IDs. Support confirmed assignment submissions first so a student can complete a lesson/quiz demo flow.
4. Teacher workflow: class/assignment reads and writes, submission list, grade/return/revision with feedback.
5. Admin workflow: create/update/deactivate users, overview, health/storage metrics, backup and restore.
6. Calendar events and remaining planned curriculum, quiz, materials, portfolio, and file upload endpoints.

Also implement endpoints already called by the client: `GET /api/admin/health`, `GET /api/admin/overview`, `POST/PATCH/DELETE /api/admin/users`, `POST/PATCH /api/classes`, `POST/DELETE /api/classes/:id/members`, `POST/PATCH /api/assignments`, `GET /api/assignments/:id/submissions`, `POST /api/submissions/:id/grade`, `POST /api/calendar/events`, `POST /api/admin/backups`, `POST /api/admin/backups/:id/restore`, and `POST /api/sync/operations`.

For the first test demo, seed clearly labeled demo accounts and a class, lesson content, assignment, and quiz; demonstrate connect/login, fetch snapshot, open lesson, submit quiz/assignment, and teacher feedback. Keep demo credentials out of production and require changing/removing them before deployment. The demo may use local/mock seed data, but its API and SQLite path should be real so the flow proves the integration.

Every protected request must authenticate and authorize by role and class membership. Validate all IDs and payloads server-side. Do not accept a client-supplied student ID as authority; derive actor identity from the session. Return consistent JSON errors and appropriate HTTP status codes. Avoid exposing answer keys, password hashes, session tokens, or filesystem paths.

## Files, backup, and recovery

Store files under a configured data directory using generated UUID keys, never user filenames as paths. Verify upload size, MIME type, and checksum. Write the file safely before committing its metadata row; clean up orphaned files after failed transactions.

<<<<<<< HEAD
Create a consistent SQLite backup using the SQLite backup API or `VACUUM INTO`, archive the file directory from the same backup window, and write a manifest with timestamps and SHA-256 checksums. Restore both database and files together; do not overwrite the live data until a restore has been validated. Keep a copy on external storage where possible. SQLite's single-writer model is suitable for the initial Pi deployment; use short transactions and WAL, and measure under expected classroom concurrency.

## Security and operations

- Bind the API to the Pi's LAN/hotspot address or a controlled interface and do not expose SQLite itself over the network.
- Hash passwords with a modern password-hashing function; store only hashes.
- Use random, expiring sessions and revoke on logout; rate-limit login attempts.
- Enforce authorization on every read and write, including sync operations.
- Limit request and upload sizes; log authentication failures, authorization denials, sync conflicts, and backup results without logging secrets.
- Keep the app data directory restricted to the service account and make the database/file directory writable only by that account.
- Preserve existing Pi services and network configuration during deployment.
=======
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

Quiz attempts are append-only. The API must reject edits and deletes after submission, and enforce one attempt per student per quiz with a unique key on (`quiz_id`, `student_id`). The client may encrypt its local cached answer payload, but the Raspberry Pi remains the authoritative source for teacher feedback and final grades.

Assignment grades belong to individual submissions or assignment records. The server should not calculate or persist an overall grade for a class in this project scope.

### `calendar_events`

Stores assignment deadlines, class events, school events, holidays, and reminders.

Student-created personal events are intentionally not stored in this server table for the current scope; they remain local-only on the client.

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

SQLite stores metadata, not uploaded file contents. Files should be stored below a configured application data directory, for example:

```text
/srv/locallearn/data/files/{entity}/{uuid}
```

The database stores the generated `storage_key`, original filename, MIME type, byte size, and SHA-256 checksum. User-provided filenames must never become raw filesystem paths.

## Backups and recovery

The server should create:

1. A daily SQLite backup using SQLite's backup API or a consistent file-copy process while using WAL mode.
2. A matching backup of the file-storage directory.
3. A backup manifest containing database dump name, file archive name, timestamp, and checksum.
4. At least one copy on an external USB drive or other storage device.

Backups should be tested by restoring them to a separate SQLite database and checking that file checksums match the manifest. The Raspberry Pi’s SD card should not be treated as the only copy of student records.

## Security and operations

- Keep the SQLite database in the server data directory and do not expose the database file over the network.
- Bind the API to the Raspberry Pi’s local network interface and use API authentication.
- Hash passwords with a modern password-hashing algorithm.
- Validate authorization on the server even when a client supplies a class or user ID.
- Limit upload size and reject unexpected MIME types.
- Log authentication failures, permission failures, synchronization conflicts, and backup results.
- Keep server time consistent because due dates, receipts, and grading timestamps depend on it.
>>>>>>> bdb58b778f911779bb72d693142aa250a9eacb5e

## Decisions still to confirm during implementation

<<<<<<< HEAD
- Demo account names/passwords and whether demo seeding is enabled by a one-time command or environment flag.
- Maximum upload size, backup retention, and external backup device.
- Whether the test demo uses HTTPS or stays on the isolated hotspot over HTTP.
- Expected simultaneous clients and acceptable sync retry behavior.
- Which later planned features are in the demo versus post-demo milestones.
=======
- Raspberry Pi model and available RAM
- SQLite/Python version supplied by the Raspberry Pi OS image
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
>>>>>>> bdb58b778f911779bb72d693142aa250a9eacb5e
