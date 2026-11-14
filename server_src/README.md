# LocalLearn Raspberry Pi server

This is a small, dependency-free Python HTTP server backed by SQLite. It is intended to run on the Raspberry Pi host named `photobooth`, so devices can connect to `http://photobooth` over the local network.

## Run

From the repository root:

```bash
python3 -m server_src --host 0.0.0.0 --port 8080
```

The database and file directory are created in `./server_data`. Set `LOCALLEARN_DATA_DIR` to move them to an attached drive. `LOCALLEARN_HOST`, `LOCALLEARN_PORT`, and `LOCALLEARN_MAX_UPLOAD_BYTES` are also supported.

The Expo app uses `http://photobooth` by default. Override it with `EXPO_PUBLIC_LMS_SERVER_URL` when the hostname is unavailable, and set `EXPO_PUBLIC_LMS_USERNAME` / `EXPO_PUBLIC_LMS_PASSWORD` so the app can authenticate at startup.

The first administrator can be created with the included bootstrap script:

```bash
python3 -m server_src.bootstrap_admin admin "School Administrator" "change-this-password"
```

For production, replace the password, restrict the Pi firewall to the school LAN, and put the service behind TLS if traffic leaves a trusted network. SQLite WAL mode is enabled for better concurrent read behavior; use regular backups of both `locallearn.sqlite3` and `files/`.

