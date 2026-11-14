# Raspberry Pi Server and Database Architecture

This document defines the LocalLearn server on the Raspberry Pi. SQLite is used by both the server and the Expo client, but each device has its own database: the Pi database is authoritative and each client database is a cache, offline work area, and outbox. Clients must never open or share the Pi's database file. All server data access goes through the local API.

## Technology and deployment

- Database: SQLite 3, using the operating system's SQLite library.
- API: Node.js service on the Raspberry Pi, on a dedicated port (the current deployment plan reserves 8090).
- File storage: generated paths under `/srv/locallearn/data/files/` (or a configured data directory).
- Backups: SQLite online backup or `VACUUM INTO`, plus a matching archive of uploaded files and a manifest.
- Network: available on the LocalLearn LAN without internet; preserve the existing gallery and gameboard services.

The server should open one database connection/pool, enable `PRAGMA foreign_keys = ON` on every connection, use WAL mode for concurrent readers, set a busy timeout, and use parameterized queries and transactions. Store timestamps as UTC ISO-8601 text and UUIDs as text. SQLite has no dedicated enum, datetime, or JSON column types: use `TEXT`, `INTEGER` (0/1 booleans), and JSON encoded as `TEXT` with `json_valid` checks where supported. Use `CHECK` constraints for role/status values. Apply numbered migrations transactionally and record them in `schema_migrations`.

## Design principles

1. The Pi's SQLite database is the server source of truth; the API is its only application interface.
2. The client has a separate SQLite cache/outbox and remains useful when disconnected.
3. Stable client-generated operation IDs make retries idempotent.
4. Use transactions for multi-row changes such as grading plus feedback, enrollment, and sync operations.
5. Prefer archival/active flags over destructive deletion where records must be retained.
6. Store uploaded file bytes outside SQLite and keep only generated storage keys and metadata in tables.
7. Keep schema changes in ordered migrations; take a verified backup before upgrades.

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

Create a consistent SQLite backup using the SQLite backup API or `VACUUM INTO`, archive the file directory from the same backup window, and write a manifest with timestamps and SHA-256 checksums. Restore both database and files together; do not overwrite the live data until a restore has been validated. Keep a copy on external storage where possible. SQLite's single-writer model is suitable for the initial Pi deployment; use short transactions and WAL, and measure under expected classroom concurrency.

## Security and operations

- Bind the API to the Pi's LAN/hotspot address or a controlled interface and do not expose SQLite itself over the network.
- Hash passwords with a modern password-hashing function; store only hashes.
- Use random, expiring sessions and revoke on logout; rate-limit login attempts.
- Enforce authorization on every read and write, including sync operations.
- Limit request and upload sizes; log authentication failures, authorization denials, sync conflicts, and backup results without logging secrets.
- Keep the app data directory restricted to the service account and make the database/file directory writable only by that account.
- Preserve existing Pi services and network configuration during deployment.

## Decisions still to confirm during implementation

- Demo account names/passwords and whether demo seeding is enabled by a one-time command or environment flag.
- Maximum upload size, backup retention, and external backup device.
- Whether the test demo uses HTTPS or stays on the isolated hotspot over HTTP.
- Expected simultaneous clients and acceptable sync retry behavior.
- Which later planned features are in the demo versus post-demo milestones.
