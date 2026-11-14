# LocalLearn implemented architecture

Verified on November 14, 2026. `architecture.md` describes the product direction; this file records the implementation and its deployment limits.

## Runtime and authentication

The Expo/React Native client uses the authenticated server role for student, teacher, and administrator navigation. There is no production role switcher or automatic login using bundled passwords. The Python standard-library API in `server_src/` runs on the Raspberry Pi and owns the authoritative SQLite database and uploaded files.

First login requires the school's LAN and a school account. Subsequent launches restore the session and local encryption key from the device settings database before making network requests. Sessions have no idle expiry, survive Pi restarts, and are removed from the client only by manual sign-out. Disabled accounts cannot access the server; a disconnected device can still open its existing cache. No plaintext login password is retained. Session credentials and the encryption key are protected by application storage permissions, not a hardware keystore.

Each account has a separate SQLite cache. New native resource and submission files use account-specific directories. Account-generation checks reject stale clients after sign-out, including signing back into the same account. Manual sign-out waits for the saved session to be removed; an unreachable Pi does not prevent local sign-out. Server-side token revocation requires the Pi to receive the logout request.

## Assignments and classroom documents

The teacher composer supports:

- Whole-class or selected-student assignments with title, description/instructions, local due date and optional time (11:59 PM when blank).
- File, photo, and camera submission choices, plus late and resubmission rules.
- Multiple reference documents, with a persistent local draft and attachment removal before publication.
- Text-based class materials and a question builder for multiple-choice, true/false, and written-answer quizzes.
- Question prompts, answer choices, correct-answer selection, point values, and adding/removing questions.

Teacher publication first enters an encrypted outbox with stable operation and attachment IDs. Native documents are copied into application storage; browser document data is retained in encrypted cache records. A retry reuses those IDs instead of creating another assignment or upload.

Snapshots include assignment descriptions, deadlines, rules, resource metadata, and submission receipts. Sync waits for resource download attempts, caches successful files for disconnected access, and displays a retry indicator if a resource could not be downloaded. Other documents and classroom metadata remain usable when one resource fails. Native files are downloaded to temporary paths and become cache entries only after a successful response.

Student written drafts and staged files are saved locally. Confirmation creates the local submission and outbox record together. Locally confirmed work counts as completed but displays `saved_locally` until the Pi receives the file and attaches it to the submission. Native written responses are converted into files for upload, including data-URL responses queued by older versions. The server excludes incomplete uploads from teacher reviews and completed assignment receipts.

## Quiz and calendar behavior

A student quiz attempt is immutable after local insertion. Answers use the account's authenticated encryption envelope with a nonce and integrity digest. Native encryption uses Expo Crypto for secure randomness. Written-answer attempts remain ungraded until teacher review; objective answers are scored by the Pi, and teacher scores appear in subsequent snapshots. Server question IDs and quiz deadlines survive synchronization.

The student quiz screen restores its saved attempt and draft before allowing submission, prevents repeated taps while saving, and requests answers to all questions. Assignments and quizzes have distinct completion checks. Date filters include the entire final Sunday. Assignment calendar entries update when their deadlines change; downloaded quizzes also create local calendar entries.

## Synchronization and authorization

The client opens its account cache before background sync. A worker retries every 20 seconds while the app is running, and the refresh control retries immediately. Refreshes share one in-flight operation. Failed outbox records remain queued with diagnostic information; successful records are removed only after delivery. Applying a snapshot preserves pending local submissions and immutable quiz attempts, hides revoked records from navigation, and retains unpublished local entities and personal calendar events.

The server checks authentication, roles, class ownership/enrollment, file ownership, and submission access. Mutation receipts reject reuse of an operation ID with different data. Server authorization remains authoritative; local encryption is not a substitute for access control.

Administrators can manage users/classes/enrollment and request backups/restores. Backups include the SQLite database and uploaded files. Teacher workspaces support roster changes, missing-submission review, numeric or letter grading, written feedback, returns, revision requests, quiz review, and queued submissions on behalf of enrolled students. Individual assignment recipients are enforced for snapshots, file access, and submissions. Class creation supports optional sections. Administrators can see server storage availability.

## Deployment

- Configure `EXPO_PUBLIC_LMS_SERVER_URL` if the default Pi addresses are unsuitable. In a production browser build, the app first uses the HTTPS origin serving it. Explicit HTTPS origins retain their default port.
- Bootstrap an administrator as described in `server_src/README.md`. Do not bundle usernames/passwords in Expo public environment variables.
- Build Android packages with application code bundled locally. Expo Go and development-server sessions are not standalone offline installations. Native dependency changes require a rebuilt application.
- For browser deployment, run `npm run build:web:offline`, copy `dist/` to the Pi, and use HTTPS with a browser-trusted certificate. The Pi serves the SQLite isolation headers. Plain LAN HTTP cannot provide browser offline cold starts. Native Android remains the first target.
- A resource must finish downloading once before disconnected use. Clearing browser storage, uninstalling the app, or deleting application data removes the login and unsent local work.

## Verification

- TypeScript type checking.
- Twelve client regression tests covering encrypted saves, offline session/key restoration, attachment retries and offline reads, partial-download cleanup, account isolation, HTTPS discovery, pending completion, immutable attempts, local deadlines, and native written-response uploads.
- Python API integration covering authentication and role/class boundaries, assignment metadata/resources, original file bytes, incomplete-upload visibility, grading/feedback, quiz scoring and written-answer review, persistent sessions across restarts, disabled accounts, logout, individual recipient privacy, teacher-assisted submissions, letter grades, storage reporting, database upgrades, and file/database backup restoration.
- Production web export and Android JavaScript/Hermes export. These exports do not replace installation and device testing of a signed APK.

## Remaining product and deployment scope

The requested assignment, quiz, offline session, and classroom delivery flows are implemented. Existing installations receive server migration 003 for individual assignment recipients and class sections; the client upgrades its cache to version 4. Restoring a backup applies current server migrations before resuming service.

No physical Pi/Android/iOS deployment, camera/file-handler check on target hardware, full-storage/power-loss test, multi-device load test, school certificate provisioning, or offline installation/update package distribution was performed in this review. Those remain deployment acceptance work. Advanced quizzes, large media, and collaborative documents remain future scope from `architecture.md`.
