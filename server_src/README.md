# LocalLearn Raspberry Pi server

## Account-based application workflow

All students and staff now sign in through the application's login screen. The server supplies the role; the role switcher and student developer tab have been removed. Do not bundle shared usernames or passwords in Expo environment variables. `EXPO_PUBLIC_LMS_SERVER_URL=http://photobooth.local:9000` remains the optional server override.

Create the first administrator using the bootstrap command below. Sign in as that administrator, open Workspace, create teacher/student accounts, assign a teacher when creating a class, and enroll students. Teachers see only their own classes and students see only enrolled classes. Each signed-in account uses a separate device cache. Sessions persist in SQLite across Pi restarts, with no automatic expiry; the app restores its login and cache offline until the user manually signs out. Disabled accounts are still denied server access.

## Offline builds and classroom documents

Teachers can assign work to a whole class or selected enrolled students, submit documents or photos on a student's behalf, enter numeric or letter grades, and configure optional class sections. Teachers can draft assignments with descriptions, due dates/times, late/resubmission rules, allowed submission types, and document attachments. The question builder supports multiple-choice, true/false, and written answers. Drafts, grades, quizzes, and pending uploads are saved locally and retried automatically while the app is open. Students can open downloaded assignment resources and submit files or written responses offline; the Pi confirms final receipt after reconnecting.

Build native Android APKs for reliable offline launches without any web server. For production web, run `npm run build:web:offline` on the build machine and copy the resulting `dist/` folder alongside `server_src/` on the Pi. The API serves that folder on port 9000 and sends the cross-origin isolation headers needed by Expo SQLite. Override its location with `LOCALLEARN_WEB_DIR` if necessary. Serve it through HTTPS with a browser-trusted certificate for service-worker installation and offline browser reloads; HTTP on a LAN hostname does not satisfy browser secure-context requirements. Keep the API and web app under the same HTTPS origin, or explicitly configure the HTTPS API URL in the build. No internet service is needed at runtime.

Only files already downloaded to the device are available offline. Keep the app connected once while its documents download. Browser storage clearing, app uninstall, or deleting application data removes the saved login and local unsent work.

Verification: `npm run typecheck`, `npm run test:offline` (12 client regressions), and `python3 -m unittest server_src.test_access -v`. Production exports can be checked with `npm run build:web:offline` and `npx expo export --platform android --output-dir .expo-export`. Rebuild the native app after installing native dependency changes, including Expo Crypto.

Students select a file and confirm submission. The encrypted local outbox retains work until the authenticated file upload, submission receipt, and file attachment all succeed. Teachers open Workspace to download original files, write feedback, assign grades, return work, or request revisions. Student snapshots include authoritative grades and feedback. The teacher workspace also publishes text materials and written-answer quizzes and reviews quiz responses; multiple-choice quiz scoring happens on the server.

Encryption of the device outbox is separate from file delivery. Uploaded file bytes are stored as original files on the Pi and are served only to the owner, assigned teacher, or administrator. They are not encrypted at rest on the Pi. Use HTTPS for deployment if login credentials and submission content need protection on the network. Existing files uploaded by the previous unauthenticated debug uploader have no ownership metadata; submit them again after signing in.

Run the access-control integration test from the repository root with `python3 -m unittest server_src.test_access -v`. It checks login, role and class boundaries, upload/download bytes, grading, feedback, logout, and quiz scoring.

A small Python HTTP API backed by SQLite. It uses only Python's standard library, so no pip packages or database server need to be installed on the Pi. The application API is assigned port 9000. Existing gallery, gameboard, NetworkManager, and dnsmasq services do not need to be changed.

## Dependencies on the Pi

Install/check only the OS tools below (Debian 13 / Raspberry Pi OS):

```sh
sudo apt update
sudo apt install -y python3 sqlite3 git
python3 --version
sqlite3 --version
```

No `pip install`, virtual environment, MySQL, or Node package installation is required for the Python backend. If using the Expo client as a web app, build/run that separately with the project's Node.js dependencies.

## Get the project onto the Pi

Use the existing checkout at `/home/pi/school/ihack2026`. From an SSH session:

```sh
cd /home/pi/school/ihack2026
git pull
```

If GitHub access is not configured, transfer the updated `server_src/` directory from the development computer to that checkout instead. Keep the existing photo gallery and gameboard directories untouched.

## Create the server data directory and admin

Keep application data outside the Git checkout. This command creates a dedicated service account and data directory:

```sh
sudo useradd --system --home /var/lib/locallearn --create-home --shell /usr/sbin/nologin locallearn
sudo install -d -o locallearn -g locallearn -m 0750 /var/lib/locallearn
```

Create the first administrator with a strong password. Run this as the `locallearn` account so the database is created with correct ownership:

```sh
cd /home/pi/school/ihack2026
sudo -u locallearn env LOCALLEARN_DATA_DIR=/var/lib/locallearn python3 -m server_src.bootstrap_admin admin "School Administrator" 'CHOOSE-A-STRONG-PASSWORD'
```

Replace the sample password before running the command. The backend stores a password hash, not the plaintext password.

## Start once for a demo

```sh
cd /home/pi/school/ihack2026
sudo -u locallearn env LOCALLEARN_DATA_DIR=/var/lib/locallearn LOCALLEARN_HOST=0.0.0.0 LOCALLEARN_PORT=9000 python3 -m server_src
```

Leave that SSH session running. From a second SSH session, check the local API:

```sh
curl http://127.0.0.1:9000/api/admin/health
```

The public health route returns a minimal availability response. Sign in as an administrator to see storage monitoring, or check that the process is listening with `ss -ltnp | grep 9000`. On a phone connected to `Photobooth-AP`, configure the Expo build with `EXPO_PUBLIC_LMS_SERVER_URL=http://192.168.4.1:9000`. For the demo account, provide the admin-created student credentials using the app's login configuration. Do not put a real password into a source-controlled `.env` file.

## Run at boot with systemd

After the one-time start works, create a service unit:

```sh
sudo tee /etc/systemd/system/locallearn.service >/dev/null <<'EOF'
[Unit]
Description=LocalLearn offline learning server
After=network.target

[Service]
Type=simple
User=locallearn
Group=locallearn
WorkingDirectory=/home/pi/school/ihack2026
Environment=LOCALLEARN_DATA_DIR=/var/lib/locallearn
Environment=LOCALLEARN_HOST=0.0.0.0
Environment=LOCALLEARN_PORT=9000
ExecStart=/usr/bin/python3 -m server_src
Restart=on-failure
RestartSec=3
UMask=0027

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now locallearn.service
sudo systemctl status locallearn.service --no-pager
```

Useful service commands:

```sh
sudo journalctl -u locallearn.service -f
sudo systemctl restart locallearn.service
sudo systemctl stop locallearn.service
```

## Demo readiness and current limits

The API includes login, role checks, snapshot, class/assignment management, submissions and grading, events, sync idempotency, admin overview/health, backups, and file handling. Review the endpoint/client contract in `IMPLEMENTED_ARCHITECTURE.md`. A successful server start does not automatically seed demo users, classes, lessons, or quizzes. Create the admin first, then use the app/admin API to create accounts and classes and add demo content. The current client startup has environment-based demo credentials; use a temporary demo build/configuration and remove the credentials afterward.

The browser client may need CORS headers (the API currently handles browser preflight). If a browser reports a blocked request, use the Pi URL and ensure the server's CORS response allows the development origin. Do not expose this HTTP service to an untrusted upstream network. Keep it on the hotspot LAN for the demo.

## Data and backups

The default data location is `./server_data`; set `LOCALLEARN_DATA_DIR` to move it. The service creates `locallearn.sqlite3`, `files/`, and `backups/`. The schema enables SQLite foreign keys and WAL mode. Use the API backup feature or stop the service before copying database files manually; copy the database and file directory as one backup set.
