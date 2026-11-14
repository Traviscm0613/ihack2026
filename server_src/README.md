# LocalLearn Raspberry Pi server

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

The admin health route requires login in the current implementation; use the app to log in, or check that the process is listening with `ss -ltnp | grep 9000`. On a phone connected to `Photobooth-AP`, configure the Expo build with `EXPO_PUBLIC_LMS_SERVER_URL=http://192.168.4.1:9000`. For the demo account, provide the admin-created student credentials using the app's login configuration. Do not put a real password into a source-controlled `.env` file.

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
