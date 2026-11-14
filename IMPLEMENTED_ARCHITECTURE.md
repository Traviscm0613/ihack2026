# LocalLearn implemented architecture

This document is the implementation handoff for the current React Native/Expo client. It records the behavior that is in the repository now and the Raspberry Pi integration points that remain deployment-specific.

## Runtime shape

The client is a local-first Expo application. `App.tsx` owns navigation, the active role workspace, theme selection, database initialization, and refresh behavior. The app defaults to the student experience and has a role switcher for exercising the teacher and administrator surfaces until server authentication is connected.

The three supported application roles are:

- Student: dashboard, calendar, assignments, class materials, assignment staging/submission, quiz attempts, local completion, and offline outbox state.
- Teacher: assignment publishing, submission review, grading/feedback, return/revision decisions, class context, and local sync state.
- Administrator: account creation/disablement, local user inventory, health status, backup readiness, and the server operations area.

`src/components/NavigationBar.tsx` exposes student navigation separately from the staff navigation. The current role button is deliberately a temporary development control; production should replace it with the authenticated session returned by `/api/auth/login`.

## Local data layer

`src/db/database.ts` is the client cache and work area. It is never intended to be the Raspberry Pi database. The database contains cached classes, assignments, events, materials, quizzes, quiz questions, immutable quiz attempts, submissions, users, class memberships, outbox records, and sync metadata.

Important local-first rules implemented:

1. Assignment and event writes are immediately available offline.
2. Submission confirmation creates a stable submission id, marks the work locally complete, and inserts an outbox record.
3. Completion and grading changes are queued with stable ids so retries do not create duplicate operations.
4. Quiz answers are encrypted locally, integrity-protected, and quiz attempt rows are immutable through SQLite triggers.
5. Personal/local calendar entries are distinct from server-backed events.
6. Browser builds keep selected submission data in SQLite; native builds may use a file URI in the same record.
7. Versioned server migrations remain separate from the client cache schema.

The current seed accounts (`demo-student`, `demo-teacher`, and `demo-admin`) exist only for local development. They are not production credentials.

## Server boundary

`src/services/serverApi.ts` contains the single typed integration boundary, `LocalServerClient`. Set `EXPO_PUBLIC_LMS_SERVER_URL` to the Raspberry Pi base URL; no other client code should construct Pi URLs directly.

## Local confidentiality and tamper resistance

Sensitive local submission content, grading changes, and every outbox payload are stored as authenticated `tweetnacl.secretbox` envelopes with a nonce, ciphertext, and integrity digest. The sync queue decrypts and validates each record before sending it, retains failed records with an attempt count/error, and removes records only after the server acknowledges their stable operation ids. Quiz answers use the same authenticated-encryption approach and remain immutable after insertion.

The protection key is configured from the authenticated server session token after `LocalServerClient.login`. The temporary offline/demo role switch uses a development fallback key and is not a security boundary. Production must replace that switcher with login/session restoration backed by platform secure storage (for example, Expo SecureStore) before deploying shared devices.

Encryption cannot make a client device trustworthy against a student who controls the operating system, can reverse engineer the app, or can edit the local database. The Raspberry Pi remains authoritative: it must authenticate every request, authorize every role/entity, validate grades and roster changes, reject malformed or replayed operation ids, and return authoritative status in snapshots. Local encryption protects data at rest and detects ordinary local tampering; it does not replace server authorization.

Implemented client methods and expected endpoint shapes:

| Capability | Endpoint |
| --- | --- |
| Login/logout | `POST /api/auth/login`, `POST /api/auth/logout` |
| Snapshot | `GET /api/snapshot` |
| Health/overview | `GET /api/admin/health`, `GET /api/admin/overview` |
| User administration | `POST/PATCH/DELETE /api/admin/users` |
| Classes and enrollment | `POST/PATCH /api/classes`, `POST/DELETE /api/classes/:id/members` |
| Assignments | `POST/PATCH /api/assignments` |
| Submission review | `GET /api/assignments/:id/submissions` |
| Grade/return/revision | `POST /api/submissions/:id/grade` |
| Calendar | `POST /api/calendar/events` |
| Backup/restore | `POST /api/admin/backups`, `POST /api/admin/backups/:id/restore` |

The API client adds the bearer token, JSON headers, consistent error handling, and trailing-slash normalization. UI mutations attempt the server call when configured but retain the local result when the Pi is unavailable; the outbox/sync service is the place to add retry delivery and server acknowledgement handling.

## Server database and storage

`migrations/001_initial_schema.sql` defines the authoritative server model: users and roles, classes/memberships, assignments/resources, submissions/files/feedback, quizzes/attempts, calendar events, class materials, sync operation idempotency, and schema migration tracking. `server-database-architecture.md` documents the MySQL/SQLite deployment choice, storage layout, backup expectations, security boundary, and API responsibilities.

The Raspberry Pi implementation still needs to provide the endpoint handlers, authentication/session issuance, authorization checks, file storage, upload streaming, backup execution, and health metrics. The client is prepared for those endpoints and does not access server SQL directly.

## Verification and deployment checklist

1. Set `EXPO_PUBLIC_LMS_SERVER_URL` to the Pi LAN address.
2. Replace the temporary role switcher with the authenticated session from `LocalServerClient.login`.
3. Implement the endpoint shapes listed above against the server migration schema.
4. Make sync processing idempotent using the outbox record id / `sync_operations` table.
5. Return a snapshot compatible with `ServerSnapshot` and include authoritative grade/status updates.
6. Test offline submission, reconnect/retry, logout/session expiry, shared-device separation, backup/restore, and full-storage behavior on target Android devices.

