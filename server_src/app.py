"""LocalLearn HTTP API for the Raspberry Pi (standard library only)."""

import argparse
import hashlib
import json
import shutil
import sqlite3
import threading
import traceback
import uuid
import zipfile
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from .config import Settings
from .db import Database
from .security import hash_password, verify_password


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def uid():
    return str(uuid.uuid4())


def parse_json(value, default=None):
    if value in (None, ""):
        return default
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default


def as_bool(value, default=True):
    return int(bool(default if value is None else value))


def public_user(row):
    return {"id": row["id"], "username": row["username"], "displayName": row["display_name"], "role": row["role"], "active": bool(row["active"]), "createdAt": row["created_at"]}


class LocalLearnServer:
    def __init__(self, settings):
        self.settings = settings
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        settings.files_dir.mkdir(parents=True, exist_ok=True)
        (settings.data_dir / "backups").mkdir(parents=True, exist_ok=True)
        self.db = Database(settings.database_path, Path(__file__).with_name("schema.sql"))
        self.sessions = {}
        self.sessions_lock = threading.Lock()

    def user_for_token(self, token):
        with self.sessions_lock:
            user_id = self.sessions.get(token)
        if not user_id:
            return None
        with self.db.connection() as db:
            return db.execute("SELECT * FROM users WHERE id = ? AND active = 1", (user_id,)).fetchone()

    def create_session(self, user_id):
        token = uuid.uuid4().hex + uuid.uuid4().hex
        with self.sessions_lock:
            self.sessions[token] = user_id
        return token

    def snapshot(self, user_id=None):
        with self.db.connection() as db:
            classes = db.execute("SELECT c.*, u.display_name AS teacher_name FROM classes c JOIN users u ON u.id = c.teacher_id WHERE c.active = 1 ORDER BY c.name").fetchall()
            assignments = db.execute("SELECT a.*, c.name AS subject, u.display_name AS teacher_name FROM assignments a JOIN classes c ON c.id = a.class_id JOIN users u ON u.id = a.created_by WHERE a.active = 1 ORDER BY a.due_at").fetchall()
            events = db.execute("SELECT * FROM calendar_events ORDER BY starts_at").fetchall()
            quizzes = db.execute("SELECT * FROM quizzes WHERE active = 1 ORDER BY due_at").fetchall()
            questions = db.execute("SELECT * FROM quiz_questions ORDER BY quiz_id, position").fetchall()
            materials = db.execute("SELECT * FROM class_materials ORDER BY title").fetchall()
            completed = {r["assignment_id"] for r in db.execute("SELECT assignment_id FROM submissions WHERE student_id = ?", (user_id,)).fetchall()} if user_id else set()
        class_data = [{"id": r["id"], "name": r["name"], "sectionName": None, "teacher": r["teacher_name"], "location": r["room"] or "", "grade": r["term"] or "", "color": "purple", "description": r["description"]} for r in classes]
        assignment_data = [{"id": r["id"], "title": r["title"], "subject": r["subject"], "teacher": r["teacher_name"], "due": r["due_at"] or "", "dueDate": (r["due_at"] or "")[:10], "progress": 100 if r["id"] in completed else 0, "status": "completed" if r["id"] in completed else "upcoming", "completed": r["id"] in completed, "tone": "math", "classId": r["class_id"], "description": r["description"], "submissionTypes": parse_json(r["allowed_submission_types"], ["file"]), "grade": None, "feedback": None} for r in assignments]
        event_data = [{"id": r["id"], "title": r["title"], "date": r["starts_at"][:10], "time": r["starts_at"][11:16], "notes": r["description"] or "", "kind": r["event_type"], "assignmentId": r["assignment_id"]} for r in events]
        quiz_data = []
        for quiz in quizzes:
            quiz_data.append({"id": quiz["id"], "classId": quiz["class_id"], "title": quiz["title"], "description": quiz["description"], "dueDate": (quiz["due_at"] or "")[:10], "questions": [{"id": q["id"], "quizId": q["quiz_id"], "prompt": q["prompt"], "type": q["question_type"], "options": parse_json(q["options"], []), "correctAnswer": None, "points": q["points"]} for q in questions if q["quiz_id"] == quiz["id"]]})
        material_data = [{"id": r["id"], "classId": r["class_id"], "title": r["title"], "type": r["material_type"], "uri": r["storage_key"], "content": r["content_text"] or ""} for r in materials]
        return {"assignments": assignment_data, "classes": class_data, "events": event_data, "quizzes": quiz_data, "materials": material_data, "serverTime": timestamp()}


class Handler(BaseHTTPRequestHandler):
    server_version = "LocalLearn/1.1"

    @property
    def service(self):
        return self.server.service

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def cors_headers(self):
        # Keep the local API usable from Expo web and from a browser opened on
        # the Pi hostname.  The API is intended to stay on the private hotspot
        # LAN, so wildcard access is appropriate here and avoids coupling the
        # Pi to a particular dev-server port.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Max-Age", "86400")

    def send_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.cors_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def empty(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.cors_headers()
        self.end_headers()

    def error(self, status, message):
        self.send_json({"error": message}, status)

    def auth_token(self):
        return self.headers.get("Authorization", "").removeprefix("Bearer ").strip()

    def require(self, roles=None, anonymous=False):
        user = self.service.user_for_token(self.auth_token())
        if not user and anonymous:
            return None
        if not user:
            self.error(HTTPStatus.UNAUTHORIZED, "Authentication required")
            return None
        if roles and user["role"] not in roles:
            self.error(HTTPStatus.FORBIDDEN, "Insufficient permissions")
            return None
        return user

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > self.service.settings.max_upload_bytes:
            raise ValueError("Request body is too large")
        return json.loads(self.rfile.read(length) or b"{}")

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.cors_headers()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path == "/api/admin/health":
            total, used, free = shutil.disk_usage(self.service.settings.data_dir)
            self.send_json({"status": "ok", "version": "1.1", "database": "sqlite", "storage": {"usedBytes": used, "freeBytes": free, "totalBytes": total}, "checkedAt": timestamp()}); return
        if path == "/api/snapshot":
            user = self.require(anonymous=True)
            self.send_json(self.service.snapshot(user["id"] if user else None)); return
        if path.startswith("/api/files/"):
            self.download_file(path.split("/")[-1]); return
        if path == "/api/admin/overview":
            if not self.require({"administrator"}): return
            with self.service.db.connection() as db:
                users = [public_user(r) for r in db.execute("SELECT * FROM users ORDER BY display_name").fetchall()]
                classes = [dict(r) for r in db.execute("SELECT * FROM classes ORDER BY name").fetchall()]
                backups = [dict(r) for r in db.execute("SELECT id, created_at AS createdAt, size_bytes AS sizeBytes, status FROM backup_runs ORDER BY created_at DESC").fetchall()]
            self.send_json({"users": users, "classes": classes, "health": {"status": "ok", "database": "sqlite", "checkedAt": timestamp()}, "pendingBackups": backups}); return
        if path.startswith("/api/assignments/") and path.endswith("/submissions"):
            if not self.require({"teacher", "administrator"}): return
            assignment_id = path.split("/")[3]
            with self.service.db.connection() as db:
                rows = db.execute("SELECT s.*, u.display_name AS student_name FROM submissions s JOIN users u ON u.id = s.student_id WHERE s.assignment_id = ? ORDER BY s.submitted_at DESC", (assignment_id,)).fetchall()
                result = [self.submission_json(db, row) for row in rows]
            self.send_json(result); return
        self.error(HTTPStatus.NOT_FOUND, "Route not found")

    def submission_json(self, db, row):
        feedback = [r["comment"] for r in db.execute("SELECT comment FROM assignment_feedback WHERE submission_id = ? ORDER BY created_at", (row["id"],)).fetchall()]
        files = [{"id": r["id"], "name": r["original_name"], "mimeType": r["mime_type"], "uri": "/api/files/" + r["id"]} for r in db.execute("SELECT * FROM submission_files WHERE submission_id = ?", (row["id"],)).fetchall()]
        return {"id": row["id"], "assignmentId": row["assignment_id"], "studentId": row["student_id"], "studentName": row["student_name"], "submittedAt": row["submitted_at"], "status": row["status"], "gradeValue": row["grade_value"], "gradeLabel": row["grade_label"], "feedback": feedback, "files": files}

    def do_POST(self):
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path == "/api/files/upload":
            try:
                self.upload()
            except Exception as exc:
                # Never leave a browser fetch with ERR_EMPTY_RESPONSE. Keep
                # details in the Pi journal while returning a safe diagnostic.
                print(f"Upload failed: {exc}")
                traceback.print_exc()
                self.error(HTTPStatus.INTERNAL_SERVER_ERROR, "Upload processing failed")
            return
        try: data = self.read_json()
        except (ValueError, json.JSONDecodeError) as exc: self.error(HTTPStatus.BAD_REQUEST, str(exc)); return
        if path == "/api/auth/login":
            with self.service.db.connection() as db: user = db.execute("SELECT * FROM users WHERE username = ?", (str(data.get("username", "")),)).fetchone()
            if not user or not user["active"] or not verify_password(str(data.get("password", "")), user["password_hash"]): self.error(HTTPStatus.UNAUTHORIZED, "Invalid username or password"); return
            self.send_json({"token": self.service.create_session(user["id"]), "user": public_user(user)}); return
        if path == "/api/auth/logout":
            if self.require(): self.service.sessions.pop(self.auth_token(), None); self.empty()
            return
        if path == "/api/admin/users": self.create_user(data); return
        if path == "/api/classes": self.create_class(data); return
        if path == "/api/assignments": self.create_assignment(data); return
        if path == "/api/calendar/events": self.create_event(data); return
        if path == "/api/submissions": self.create_submission(data); return
        if path == "/api/sync/operations": self.sync(data); return
        if path == "/api/admin/backups": self.create_backup(); return
        if path.startswith("/api/classes/") and path.endswith("/members"): self.enroll(path.split("/")[3], data); return
        if path.startswith("/api/submissions/") and path.endswith("/grade"): self.grade(path.split("/")[3], data); return
        if path.startswith("/api/submissions/") and path.endswith("/files"): self.attach_submission_file(path.split("/")[3], data); return
        if path.startswith("/api/admin/backups/") and path.endswith("/restore"): self.restore_backup(path.split("/")[4]); return
        self.error(HTTPStatus.NOT_FOUND, "Route not found")

    def create_user(self, data):
        if not self.require({"administrator"}): return
        if not all(data.get(k) for k in ("username", "displayName", "password")) or data.get("role") not in ("student", "teacher", "administrator"): self.error(HTTPStatus.BAD_REQUEST, "username, displayName, password, and valid role are required"); return
        user_id, created = data.get("id", uid()), timestamp()
        try:
            with self.service.db.connection() as db:
                db.execute("INSERT INTO users VALUES (?, ?, ?, ?, ?, 1, ?, ?)", (user_id, data["username"].strip(), data["displayName"].strip(), hash_password(data["password"]), data["role"], created, created)); row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        except sqlite3.IntegrityError: self.error(HTTPStatus.CONFLICT, "Username already exists"); return
        self.send_json(public_user(row), HTTPStatus.CREATED)

    def create_class(self, data):
        user = self.require({"teacher", "administrator"})
        if not user: return
        teacher_id = data.get("teacherId", user["id"]); class_id, created = data.get("id", uid()), timestamp()
        with self.service.db.connection() as db:
            if not db.execute("SELECT id FROM users WHERE id = ? AND role IN ('teacher','administrator')", (teacher_id,)).fetchone(): self.error(HTTPStatus.BAD_REQUEST, "teacherId must identify a teacher"); return
            db.execute("INSERT INTO classes VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)", (class_id, data.get("name", "Untitled class"), data.get("description", ""), teacher_id, data.get("room", data.get("location", "")), data.get("term", data.get("grade", "")), created, created)); db.execute("INSERT OR REPLACE INTO class_memberships VALUES (?, ?, 'teacher', ?, NULL)", (class_id, teacher_id, created))
        self.send_json(next(c for c in self.service.snapshot(user["id"])["classes"] if c["id"] == class_id), HTTPStatus.CREATED)

    def create_assignment(self, data):
        user = self.require({"teacher", "administrator"})
        if not user: return
        if not data.get("classId") or not data.get("title"): self.error(HTTPStatus.BAD_REQUEST, "classId and title are required"); return
        assignment_id, created = data.get("id", uid()), timestamp(); due = data.get("dueAt", data.get("due", data.get("dueDate")))
        if due and len(str(due)) == 10: due = str(due) + "T23:59:59Z"
        with self.service.db.connection() as db:
            if not db.execute("SELECT id FROM classes WHERE id = ?", (data["classId"],)).fetchone(): self.error(HTTPStatus.NOT_FOUND, "Class not found"); return
            db.execute("INSERT INTO assignments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)", (assignment_id, data["classId"], user["id"], data["title"], data.get("description", ""), due, json.dumps(data.get("submissionTypes", data.get("allowedSubmissionTypes", ["file"]))), as_bool(data.get("allowLate")), as_bool(data.get("allowResubmission"), False), created, created))
        self.send_json(next(a for a in self.service.snapshot(user["id"])["assignments"] if a["id"] == assignment_id), HTTPStatus.CREATED)

    def create_event(self, data):
        user = self.require({"teacher", "administrator"})
        if not user: return
        event_id, created = data.get("id", uid()), timestamp(); starts = data.get("startsAt") or (str(data.get("date", created[:10])) + "T" + str(data.get("time", "00:00")) + ":00Z")
        with self.service.db.connection() as db: db.execute("INSERT INTO calendar_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (event_id, data.get("classId"), user["id"], data.get("title", "Event"), data.get("description", data.get("notes", "")), data.get("eventType", data.get("kind", "school")), starts, data.get("endsAt"), data.get("assignmentId"), created))
        self.send_json({"id": event_id, "title": data.get("title", "Event"), "date": starts[:10], "time": starts[11:16], "notes": data.get("description", data.get("notes", "")), "kind": data.get("eventType", data.get("kind", "school")), "assignmentId": data.get("assignmentId")}, HTTPStatus.CREATED)

    def create_submission(self, data):
        user = self.require({"student", "teacher", "administrator"})
        if not user: return
        submission_id, created, student_id = data.get("id", uid()), timestamp(), data.get("studentId", user["id"])
        with self.service.db.connection() as db:
            attempt = db.execute("SELECT COALESCE(MAX(attempt_number), 0) + 1 AS n FROM submissions WHERE assignment_id = ? AND student_id = ?", (data.get("assignmentId"), student_id)).fetchone()["n"]
            db.execute("INSERT INTO submissions (id, assignment_id, student_id, attempt_number, submitted_at, status, grade_value, grade_label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'submitted', NULL, NULL, ?, ?)", (submission_id, data.get("assignmentId"), student_id, attempt, created, created, created))
        self.send_json({"id": submission_id, "assignmentId": data.get("assignmentId"), "studentId": student_id, "submittedAt": created, "status": "submitted", "files": [], "feedback": [], "gradeValue": None, "gradeLabel": None}, HTTPStatus.CREATED)

    def attach_submission_file(self, submission_id, data):
        user = self.require({"student", "teacher", "administrator"})
        if not user: return
        storage_key = str(data.get("storageKey", ""))
        if not storage_key or Path(storage_key).is_absolute() or ".." in Path(storage_key).parts:
            self.error(HTTPStatus.BAD_REQUEST, "A safe storageKey is required"); return
        target = self.service.settings.data_dir / storage_key
        if not target.is_file(): self.error(HTTPStatus.NOT_FOUND, "Uploaded file not found"); return
        with self.service.db.connection() as db:
            if not db.execute("SELECT id FROM submissions WHERE id = ?", (submission_id,)).fetchone(): self.error(HTTPStatus.NOT_FOUND, "Submission not found"); return
            file_id = data.get("id", uid())
            db.execute("INSERT INTO submission_files VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (file_id, submission_id, storage_key, Path(data.get("originalName", "upload.bin")).name, data.get("mimeType", "application/octet-stream"), int(data.get("sizeBytes", target.stat().st_size)), data.get("checksumSha256", hashlib.sha256(target.read_bytes()).hexdigest()), timestamp()))
        self.send_json({"id": file_id, "submissionId": submission_id, "storageKey": storage_key}, HTTPStatus.CREATED)

    def grade(self, submission_id, data):
        teacher = self.require({"teacher", "administrator"})
        if not teacher: return
        if data.get("status") not in ("graded", "returned", "revision_requested"): self.error(HTTPStatus.BAD_REQUEST, "Invalid submission status"); return
        with self.service.db.connection() as db:
            current = timestamp(); db.execute("UPDATE submissions SET status = ?, grade_value = ?, grade_label = ?, graded_at = ?, graded_by = ?, updated_at = ? WHERE id = ?", (data["status"], data.get("gradeValue"), data.get("gradeLabel"), current, teacher["id"], current, submission_id)); db.execute("INSERT INTO assignment_feedback VALUES (?, ?, ?, ?, ?)", (uid(), submission_id, teacher["id"], data.get("feedback", ""), current)); row = db.execute("SELECT s.*, u.display_name AS student_name FROM submissions s JOIN users u ON u.id = s.student_id WHERE s.id = ?", (submission_id,)).fetchone()
            if not row: self.error(HTTPStatus.NOT_FOUND, "Submission not found"); return
            result = self.submission_json(db, row)
        self.send_json(result)

    def enroll(self, class_id, data):
        if not self.require({"teacher", "administrator"}): return
        with self.service.db.connection() as db:
            if not db.execute("SELECT id FROM classes WHERE id = ?", (class_id,)).fetchone() or not db.execute("SELECT id FROM users WHERE id = ?", (data.get("userId"),)).fetchone(): self.error(HTTPStatus.NOT_FOUND, "Class or user not found"); return
            db.execute("INSERT OR REPLACE INTO class_memberships VALUES (?, ?, 'student', ?, NULL)", (class_id, data["userId"], timestamp()))
        self.empty()

    def sync(self, data):
        user = self.require()
        if not user: return
        accepted, rejected = [], []
        with self.service.db.connection() as db:
            for operation in data.get("operations", []):
                operation_id = operation.get("id")
                if not operation_id: continue
                payload_hash = hashlib.sha256(json.dumps(operation.get("payload", {}), sort_keys=True).encode()).hexdigest(); existing = db.execute("SELECT payload_hash FROM sync_operations WHERE id = ?", (operation_id,)).fetchone()
                if existing and existing["payload_hash"] != payload_hash: rejected.append({"id": operation_id, "reason": "Operation id was already used with different data"}); continue
                if not existing: db.execute("INSERT INTO sync_operations VALUES (?, ?, ?, ?, ?, ?, ?)", (operation_id, user["id"], operation.get("type", "unknown"), operation.get("entityId", ""), payload_hash, "{}", timestamp()))
                accepted.append(operation_id)
        self.send_json({"accepted": accepted, "rejected": rejected})

    def upload(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.error(HTTPStatus.BAD_REQUEST, "Invalid Content-Length")
            return
        content_type = self.headers.get("Content-Type", "")
        if length > self.service.settings.max_upload_bytes: self.error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "File is too large"); return
        if not content_type.startswith("multipart/form-data"): self.error(HTTPStatus.BAD_REQUEST, "Expected multipart/form-data"); return
        if "boundary=" not in content_type: self.error(HTTPStatus.BAD_REQUEST, "Multipart boundary is missing"); return
        raw = self.rfile.read(length)
        message = BytesParser(policy=policy.default).parsebytes((f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n").encode() + raw)
        item = next((part for part in message.iter_parts() if part.get_param("name", header="content-disposition") == "file"), None)
        if item is None: self.error(HTTPStatus.BAD_REQUEST, "A file field is required"); return
        file_id = uid(); target = self.service.settings.files_dir / file_id; digest, size = hashlib.sha256(), 0
        content = item.get_payload(decode=True) or b""
        with target.open("wb") as output:
            output.write(content)
        size = len(content); digest.update(content)
        self.send_json({"id": file_id, "storageKey": str(target.relative_to(self.service.settings.data_dir)), "originalName": Path(item.get_filename() or "upload.bin").name, "mimeType": item.get_content_type() or "application/octet-stream", "sizeBytes": size, "checksumSha256": digest.hexdigest()}, HTTPStatus.CREATED)

    def download_file(self, file_id):
        if not file_id or Path(file_id).name != file_id:
            self.error(HTTPStatus.BAD_REQUEST, "Invalid file id"); return
        target = self.service.settings.files_dir / file_id
        if not target.is_file(): self.error(HTTPStatus.NOT_FOUND, "File not found"); return
        body = target.read_bytes()
        self.send_response(HTTPStatus.OK); self.send_header("Content-Type", "application/octet-stream"); self.send_header("Content-Length", str(len(body))); self.send_header("Access-Control-Allow-Origin", "*"); self.end_headers(); self.wfile.write(body)

    def create_backup(self):
        if not self.require({"administrator"}): return
        backup_id, created = uid(), timestamp(); archive = self.service.settings.data_dir / "backups" / (uid() + ".zip")
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
            temp = self.service.settings.data_dir / (backup_id + ".sqlite3"); source = sqlite3.connect(temp)
            with self.service.db.connection() as db: db.backup(source)
            source.close(); output.write(temp, "locallearn.sqlite3"); temp.unlink(missing_ok=True)
            for file in self.service.settings.files_dir.rglob("*"):
                if file.is_file(): output.write(file, str(file.relative_to(self.service.settings.data_dir)))
        size = archive.stat().st_size
        with self.service.db.connection() as db: db.execute("INSERT INTO backup_runs VALUES (?, ?, ?, 'complete', ?, ?)", (backup_id, str(archive), size, created, timestamp()))
        self.send_json({"id": backup_id, "createdAt": created, "status": "complete", "sizeBytes": size}, HTTPStatus.CREATED)

    def restore_backup(self, backup_id):
        if not self.require({"administrator"}): return
        with self.service.db.connection() as db: row = db.execute("SELECT archive_path FROM backup_runs WHERE id = ?", (backup_id,)).fetchone()
        if not row or not Path(row["archive_path"]).is_file(): self.error(HTTPStatus.NOT_FOUND, "Backup not found"); return
        with zipfile.ZipFile(row["archive_path"]) as archive:
            if any(Path(name).is_absolute() or ".." in Path(name).parts for name in archive.namelist()): self.error(HTTPStatus.BAD_REQUEST, "Unsafe backup archive"); return
            extracted = self.service.settings.data_dir / (backup_id + ".restore.sqlite3"); extracted.write_bytes(archive.read("locallearn.sqlite3")); source = sqlite3.connect(extracted)
            with self.service.db.connection() as db: source.backup(db)
            source.close(); extracted.unlink(missing_ok=True)
        self.send_json({"id": backup_id, "status": "restored"})

    def do_PATCH(self):
        path = urlparse(self.path).path.rstrip("/")
        try: data = self.read_json()
        except (ValueError, json.JSONDecodeError) as exc: self.error(HTTPStatus.BAD_REQUEST, str(exc)); return
        if path.startswith("/api/admin/users/"):
            if not self.require({"administrator"}): return
            entity = path.split("/")[-1]; fields, values = [], []
            for key, column in (("displayName", "display_name"), ("role", "role"), ("active", "active")):
                if key in data: fields.append(column + " = ?"); values.append(as_bool(data[key]) if key == "active" else data[key])
            if data.get("password"): fields.append("password_hash = ?"); values.append(hash_password(data["password"]))
            if not fields: self.error(HTTPStatus.BAD_REQUEST, "No fields to update"); return
            values.extend([timestamp(), entity])
            with self.service.db.connection() as db: db.execute("UPDATE users SET " + ", ".join(fields) + ", updated_at = ? WHERE id = ?", values); row = db.execute("SELECT * FROM users WHERE id = ?", (entity,)).fetchone()
            if not row: self.error(HTTPStatus.NOT_FOUND, "User not found"); return
            self.send_json(public_user(row)); return
        if path.startswith("/api/classes/"):
            if not self.require({"teacher", "administrator"}): return
            entity = path.split("/")[-1]; mapping = {"name": "name", "description": "description", "room": "room", "term": "term", "active": "active"}; fields, values = [], []
            for key, column in mapping.items():
                if key in data: fields.append(column + " = ?"); values.append(as_bool(data[key]) if key == "active" else data[key])
            if fields: values.extend([timestamp(), entity]);
            if fields:
                with self.service.db.connection() as db: db.execute("UPDATE classes SET " + ", ".join(fields) + ", updated_at = ? WHERE id = ?", values)
            self.send_json(next((c for c in self.service.snapshot()["classes"] if c["id"] == entity), {})); return
        if path.startswith("/api/assignments/"):
            if not self.require({"teacher", "administrator"}): return
            entity = path.split("/")[-1]; mapping = {"title": "title", "description": "description", "dueAt": "due_at", "dueDate": "due_at", "active": "active"}; fields, values = [], []
            for key, column in mapping.items():
                if key in data: fields.append(column + " = ?"); values.append(as_bool(data[key]) if key == "active" else data[key])
            if fields: values.extend([timestamp(), entity]);
            if fields:
                with self.service.db.connection() as db: db.execute("UPDATE assignments SET " + ", ".join(fields) + ", updated_at = ? WHERE id = ?", values)
            self.send_json(next((a for a in self.service.snapshot()["assignments"] if a["id"] == entity), {})); return
        self.error(HTTPStatus.NOT_FOUND, "Route not found")

    def do_DELETE(self):
        path = urlparse(self.path).path.rstrip("/")
        if path.startswith("/api/admin/users/"):
            if not self.require({"administrator"}): return
            with self.service.db.connection() as db: db.execute("UPDATE users SET active = 0, updated_at = ? WHERE id = ?", (timestamp(), path.split("/")[-1]))
            self.empty(); return
        if "/members/" in path:
            if not self.require({"teacher", "administrator"}): return
            class_id, user_id = path.split("/")[3], path.split("/")[-1]
            with self.service.db.connection() as db: db.execute("UPDATE class_memberships SET removed_at = ? WHERE class_id = ? AND user_id = ?", (timestamp(), class_id, user_id))
            self.empty(); return
        self.error(HTTPStatus.NOT_FOUND, "Route not found")


def main():
    parser = argparse.ArgumentParser(description="LocalLearn SQLite server for Raspberry Pi")
    parser.add_argument("--host", default=None); parser.add_argument("--port", type=int, default=None); args = parser.parse_args()
    defaults = Settings(); settings = Settings(host=args.host or defaults.host, port=args.port or defaults.port, data_dir=defaults.data_dir, max_upload_bytes=defaults.max_upload_bytes)
    server = ThreadingHTTPServer((settings.host, settings.port), Handler); server.service = LocalLearnServer(settings)
    print(f"LocalLearn server listening on http://{settings.host}:{settings.port}"); server.serve_forever()

