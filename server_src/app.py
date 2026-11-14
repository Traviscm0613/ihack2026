"""LocalLearn HTTP API for the Raspberry Pi (standard library only)."""

import argparse
import io
import mimetypes
import secrets
import hashlib
import json
import shutil
import sqlite3
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

    def user_for_token(self, token):
        with self.db.connection() as db:
            return db.execute('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND u.active=1', (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()

    def create_session(self, user_id):
        token = secrets.token_urlsafe(48)
        with self.db.connection() as db:
            db.execute('INSERT INTO sessions VALUES (?, ?, ?)', (hashlib.sha256(token.encode()).hexdigest(), user_id, timestamp()))
        return token

    def snapshot(self, user_id=None):
        with self.db.connection() as db:
            classes = db.execute("SELECT c.*, u.display_name AS teacher_name FROM classes c JOIN users u ON u.id = c.teacher_id WHERE c.active = 1 ORDER BY c.name").fetchall()
            assignments = db.execute("SELECT a.*, c.name AS subject, u.display_name AS teacher_name FROM assignments a JOIN classes c ON c.id = a.class_id JOIN users u ON u.id = a.created_by WHERE a.active = 1 ORDER BY a.due_at").fetchall()
            events = db.execute("SELECT * FROM calendar_events ORDER BY starts_at").fetchall()
            quizzes = db.execute("SELECT * FROM quizzes WHERE active = 1 ORDER BY due_at").fetchall()
            questions = db.execute("SELECT * FROM quiz_questions ORDER BY quiz_id, position").fetchall()
            materials = db.execute("SELECT * FROM class_materials ORDER BY title").fetchall()
            completed = {r['assignment_id'] for r in db.execute("SELECT assignment_id FROM submissions s WHERE student_id=? AND status NOT IN ('uploading', 'revision_requested') AND EXISTS (SELECT 1 FROM submission_files f WHERE f.submission_id=s.id)", (user_id,)).fetchall()} if user_id else set()
        class_data = [{"id": r["id"], "name": r["name"], "sectionName": r["section_name"], "teacher": r["teacher_name"], "location": r["room"] or "", "grade": r["term"] or "", "color": "purple", "description": r["description"]} for r in classes]
        assignment_data = [{"id": r["id"], "title": r["title"], "subject": r["subject"], "teacher": r["teacher_name"], "due": r["due_at"] or "", "dueDate": (r["due_at"] or "")[:10], "progress": 100 if r["id"] in completed else 0, "status": "completed" if r["id"] in completed else "upcoming", "completed": r["id"] in completed, "tone": "math", "classId": r["class_id"], "description": r["description"], "submissionTypes": parse_json(r["allowed_submission_types"], ["file"]), "grade": None, "feedback": None} for r in assignments]
        event_data = [{"id": r["id"], "title": r["title"], "date": r["starts_at"][:10], "time": r["starts_at"][11:16], "notes": r["description"] or "", "kind": r["event_type"], "assignmentId": r["assignment_id"]} for r in events]
        quiz_data = []
        for quiz in quizzes:
            quiz_data.append({"id": quiz["id"], "classId": quiz["class_id"], "title": quiz["title"], "description": quiz["description"], "dueDate": (quiz["due_at"] or "")[:10], "dueAt": quiz["due_at"], "questions": [{"id": q["id"], "quizId": q["quiz_id"], "prompt": q["prompt"], "type": q["question_type"], "options": parse_json(q["options"], []), "correctAnswer": None, "points": q["points"]} for q in questions if q["quiz_id"] == quiz["id"]]})
        material_data = [{"id": r["id"], "classId": r["class_id"], "title": r["title"], "type": r["material_type"], "uri": r["storage_key"], "content": r["content_text"] or ""} for r in materials]
        with self.db.connection() as db:
            viewer = db.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
            attempts = [dict(r) for r in db.execute('SELECT id, quiz_id AS quizId, score, status, created_at AS submittedAt FROM quiz_attempts WHERE student_id=?', (user_id,))]
            if not viewer: raise ValueError('Authentication required')
            visible = {r['id'] for r in classes if viewer['role'] == 'administrator' or r['teacher_id'] == user_id}
            if viewer['role'] == 'student':
                visible = {r['class_id'] for r in db.execute('SELECT class_id FROM class_memberships WHERE user_id = ? AND removed_at IS NULL', (user_id,))}
            for item in assignment_data:
                recipients = [r['student_id'] for r in db.execute('SELECT student_id FROM assignment_recipients WHERE assignment_id=?', (item['id'],))]
                item['recipientIds'] = recipients
                if viewer['role'] == 'student' and recipients and user_id not in recipients:
                    item['hidden'] = True
                resources = db.execute('SELECT * FROM assignment_resources WHERE assignment_id=?', (item['id'],)).fetchall()
                item['resources'] = [{'id': Path(r['storage_key']).name, 'name': r['display_name'], 'mimeType': r['mime_type']} for r in resources]
                source = next(r for r in assignments if r['id'] == item['id'])
                item['dueAt'] = source['due_at']
                item['allowLate'] = bool(source['allow_late'])
                item['allowResubmission'] = bool(source['allow_resubmission'])
                receipt = db.execute("SELECT * FROM submissions s WHERE student_id=? AND assignment_id=? AND EXISTS (SELECT 1 FROM submission_files f WHERE f.submission_id=s.id) ORDER BY submitted_at DESC LIMIT 1", (user_id, item['id'])).fetchone()
                if receipt:
                    item['submissionStatus'] = receipt['status']
                    item['submittedAt'] = receipt['submitted_at']
                    item['grade'] = receipt['grade_value']
                    item['gradeLabel'] = receipt['grade_label']
                    item['feedback'] = '\n'.join(r['comment'] for r in db.execute('SELECT comment FROM assignment_feedback WHERE submission_id = ? ORDER BY created_at', (receipt['id'],)))
        visible_assignments = {a['id'] for a in assignment_data if a['classId'] in visible and not a.get('hidden')}
        return {"assignments": [a for a in assignment_data if a['id'] in visible_assignments], "classes": [c for c in class_data if c['id'] in visible], "events": [e for e, r in zip(event_data, events) if (r['class_id'] is None or r['class_id'] in visible) and (not r['assignment_id'] or r['assignment_id'] in visible_assignments)], "quizzes": [q for q in quiz_data if q['classId'] in visible], "quizAttempts": attempts, "materials": [m for m in material_data if m['classId'] in visible], "serverTime": timestamp()}


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
        self.record_receipt(payload, status)
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.cors_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def empty(self):
        self.record_receipt(None, 204)
        self.send_response(HTTPStatus.NO_CONTENT)
        self.cors_headers()
        self.end_headers()

    def error(self, status, message):
        self.send_json({"error": message}, status)

    def record_receipt(self, payload, status):
        receipt = getattr(self, 'mutation_receipt', None)
        if receipt and 200 <= status < 300:
            with self.service.db.connection() as db:
                db.execute('INSERT OR IGNORE INTO mutation_receipts VALUES (?, ?, ?, ?)', (*receipt, json.dumps({'status': int(status), 'payload': payload})))

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
        if length < 0: raise ValueError('Invalid Content-Length')
        if length > self.service.settings.max_upload_bytes:
            raise ValueError("Request body is too large")
        return json.loads(self.rfile.read(length) or b"{}")

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.cors_headers()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path.rstrip("/") or "/"
        if not path.startswith('/api/'):
            root = self.service.settings.web_dir.resolve()
            target = (root / unquote(path).lstrip('/')).resolve()
            try: target.relative_to(root)
            except ValueError: self.error(403, 'Invalid path'); return
            if target.is_dir(): target = target / 'index.html'
            if not target.is_file() and not target.suffix: target = root / 'index.html'
            if not target.is_file(): self.error(404, 'Web build not installed. Run npm run build:web:offline.'); return
            body = target.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', mimetypes.guess_type(str(target))[0] or 'application/octet-stream')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
            self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers(); self.wfile.write(body); return
        if path == "/api/admin/health":
            total, used, free = shutil.disk_usage(self.service.settings.data_dir)
            self.send_json({"status": "ok", "version": "1.1", "database": "sqlite", "storage": {"usedBytes": used, "freeBytes": free, "totalBytes": total}, "checkedAt": timestamp()}); return
        if path == "/api/snapshot":
            user = self.require()
            if not user: return
            self.send_json(self.service.snapshot(user["id"] if user else None)); return
        if path.startswith("/api/files/"):
            self.download_file(path.split("/")[-1]); return
        if path.startswith('/api/classes/') and path.endswith('/members'):
            user = self.require({'teacher', 'administrator'})
            if not user: return
            if not self.can_manage(user, path.split('/')[3]): return
            with self.service.db.connection() as db:
                rows = db.execute("SELECT u.id, u.username, u.display_name AS displayName, u.active FROM class_memberships m JOIN users u ON u.id=m.user_id WHERE m.class_id=? AND m.removed_at IS NULL AND m.membership_role='student' ORDER BY u.display_name", (path.split('/')[3],)).fetchall()
            self.send_json([dict(row) for row in rows]); return
        if path.startswith('/api/quizzes/') and path.endswith('/attempts'):
            user = self.require({'teacher', 'administrator'})
            if not user: return
            with self.service.db.connection() as db:
                quiz = db.execute('SELECT class_id FROM quizzes WHERE id=?', (path.split('/')[3],)).fetchone()
                if not quiz or not self.can_manage(user, quiz['class_id']): return
                rows = db.execute('SELECT a.*, u.display_name AS studentName FROM quiz_attempts a JOIN users u ON u.id=a.student_id WHERE quiz_id=?', (path.split('/')[3],)).fetchall()
            self.send_json([{**dict(r), 'answers': json.loads(r['answers'])} for r in rows]); return
        if path == "/api/admin/overview":
            if not self.require({"administrator"}): return
            with self.service.db.connection() as db:
                users = [public_user(r) for r in db.execute("SELECT * FROM users ORDER BY display_name").fetchall()]
                classes = self.service.snapshot(self.service.user_for_token(self.auth_token())['id'])['classes']
                backups = [dict(r) for r in db.execute("SELECT id, created_at AS createdAt, size_bytes AS sizeBytes, status FROM backup_runs ORDER BY created_at DESC").fetchall()]
            total, used, free = shutil.disk_usage(self.service.settings.data_dir)
            self.send_json({"users": users, "classes": classes, "health": {"status": "degraded" if free < 100 * 1024 * 1024 else "ok", "database": "sqlite", "checkedAt": timestamp(), "storage": {"usedBytes": used, "freeBytes": free, "totalBytes": total}}, "pendingBackups": backups}); return
        if path.startswith("/api/assignments/") and path.endswith("/submissions"):
            if not self.require({"teacher", "administrator"}): return
            assignment_id = path.split("/")[3]
            with self.service.db.connection() as db:
                rows = db.execute("SELECT s.*, u.display_name AS student_name FROM submissions s JOIN users u ON u.id = s.student_id WHERE s.assignment_id = ? AND s.status != 'uploading' AND EXISTS (SELECT 1 FROM submission_files f WHERE f.submission_id=s.id) ORDER BY s.submitted_at DESC", (assignment_id,)).fetchall()
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
            if self.require():
                with self.service.db.connection() as db: db.execute('DELETE FROM sessions WHERE token_hash=?', (hashlib.sha256(self.auth_token().encode()).hexdigest(),))
                self.empty()
            return
        if path == "/api/admin/users": self.create_user(data); return
        if path == "/api/classes": self.create_class(data); return
        if path == "/api/assignments": self.create_assignment(data); return
        if path.startswith('/api/assignments/') and path.endswith('/resources'): self.attach_resource(path.split('/')[3], data); return
        if path == "/api/calendar/events": self.create_event(data); return
        if path == "/api/submissions": self.create_submission(data); return
        if path == '/api/quizzes': self.create_quiz(data); return
        if path == '/api/quiz-attempts': self.quiz_attempt(data); return
        if path == '/api/materials': self.create_material(data); return
        if path.startswith('/api/quiz-attempts/') and path.endswith('/grade'):
            user = self.require({'teacher', 'administrator'})
            if not user: return
            with self.service.db.connection() as db:
                row = db.execute('SELECT a.id, q.class_id FROM quiz_attempts a JOIN quizzes q ON q.id=a.quiz_id WHERE a.id=?', (path.split('/')[3],)).fetchone()
                if not row: self.error(404, 'Attempt not found'); return
                if not self.can_manage(user, row['class_id']): return
                score = data.get('score')
                if not isinstance(score, (int, float)) or score < 0: raise ValueError('A nonnegative score is required')
                db.execute("UPDATE quiz_attempts SET score=?, status='graded', graded_by=?, graded_at=?, updated_at=? WHERE id=?", (score, user['id'], timestamp(), timestamp(), row['id']))
            self.send_json({'status': 'graded'}); return
        if path == "/api/sync/operations": self.sync(data); return
        if path == "/api/admin/backups": self.create_backup(); return
        if path.startswith("/api/classes/") and path.endswith("/members"): self.enroll(path.split("/")[3], data); return
        if path.startswith("/api/submissions/") and path.endswith("/grade"): self.grade(path.split("/")[3], data); return
        if path.startswith("/api/submissions/") and path.endswith("/files"): self.attach_submission_file(path.split("/")[3], data); return
        if path.startswith("/api/admin/backups/") and path.endswith("/restore"): self.restore_backup(path.split("/")[4]); return
        self.error(HTTPStatus.NOT_FOUND, "Route not found")

    def create_material(self, data):
        user = self.require({'teacher', 'administrator'})
        if not user or not self.can_manage(user, data.get('classId')): return
        material_id, created = data.get('id', uid()), timestamp()
        with self.service.db.connection() as db:
            db.execute('INSERT INTO class_materials VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?)', (material_id, data['classId'], data['title'], data.get('type', 'resource'), data.get('content', ''), created, created))
        self.send_json({'id': material_id}, 201)

    def create_quiz(self, data):
        user = self.require({'teacher', 'administrator'})
        if not user or not self.can_manage(user, data.get('classId')): return
        if not str(data.get('title', '')).strip() or not data.get('questions'): raise ValueError('A quiz title and at least one question are required')
        quiz_id, created = data.get('id', uid()), timestamp()
        with self.service.db.connection() as db:
            db.execute('INSERT INTO quizzes VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)', (quiz_id, data['classId'], user['id'], data['title'], data.get('description', ''), data.get('dueAt', data.get('dueDate')), created, created))
            for position, q in enumerate(data.get('questions', [])):
                if q['type'] not in ('multiple_choice', 'short_answer'): raise ValueError('Invalid question type')
                if not str(q.get('prompt', '')).strip() or not isinstance(q.get('points', 1), (int, float)) or q.get('points', 1) <= 0: raise ValueError('A question and positive points are required')
                if q['type'] == 'multiple_choice' and (len(q.get('options', [])) < 2 or q.get('correctAnswer') not in q.get('options', [])): raise ValueError('Multiple-choice questions need options and a correct answer')
                db.execute('INSERT INTO quiz_questions VALUES (?, ?, ?, ?, ?, ?, ?, ?)', (q.get('id') or uid(), quiz_id, position, q['prompt'], q['type'], json.dumps(q.get('options', [])), q.get('correctAnswer'), q.get('points', 1)))
        self.send_json({'id': quiz_id}, 201)

    def quiz_attempt(self, data):
        user = self.require({'student'})
        if not user: return
        with self.service.db.connection() as db:
            quiz = db.execute('SELECT * FROM quizzes WHERE id=? AND active=1', (data.get('quizId'),)).fetchone()
            if not quiz: self.error(404, 'Quiz not found'); return
            if not db.execute('SELECT user_id FROM class_memberships WHERE class_id=? AND user_id=? AND removed_at IS NULL', (quiz['class_id'], user['id'])).fetchone(): self.error(403, 'Enrollment required'); return
            existing = db.execute('SELECT id, score, status FROM quiz_attempts WHERE quiz_id=? AND student_id=?', (quiz['id'], user['id'])).fetchone()
            if existing: self.send_json(dict(existing)); return
            answers = data.get('answers', {})
            questions = db.execute('SELECT * FROM quiz_questions WHERE quiz_id=?', (quiz['id'],)).fetchall()
            score = sum(q['points'] for q in questions if q['question_type'] == 'multiple_choice' and answers.get(q['id']) == q['correct_answer'])
            status = 'ungraded' if any(q['question_type'] == 'short_answer' for q in questions) else 'graded'
            attempt_id, created = uid(), timestamp()
            db.execute('INSERT INTO quiz_attempts VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)', (attempt_id, quiz['id'], user['id'], json.dumps(answers), None if status == 'ungraded' else score, status, created, created))
        self.send_json({'id': attempt_id, 'score': None if status == 'ungraded' else score, 'status': status}, 201)

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
        if user['role'] == 'teacher' and teacher_id != user['id']: self.error(403, 'Cannot create a class for another teacher'); return
        with self.service.db.connection() as db:
            if not db.execute("SELECT id FROM users WHERE id = ? AND role IN ('teacher','administrator')", (teacher_id,)).fetchone(): self.error(HTTPStatus.BAD_REQUEST, "teacherId must identify a teacher"); return
            db.execute("INSERT INTO classes (id, name, description, teacher_id, room, term, active, created_at, updated_at, section_name) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)", (class_id, data.get("name", "Untitled class"), data.get("description", ""), teacher_id, data.get("room", data.get("location", "")), data.get("term", data.get("grade", "")), created, created, str(data.get('sectionName') or '').strip() or None)); db.execute("INSERT OR REPLACE INTO class_memberships VALUES (?, ?, 'teacher', ?, NULL)", (class_id, teacher_id, created))
        self.send_json(next(c for c in self.service.snapshot(user["id"])["classes"] if c["id"] == class_id), HTTPStatus.CREATED)

    def create_assignment(self, data):
        user = self.require({"teacher", "administrator"})
        if not user: return
        if not data.get("classId") or not data.get("title"): self.error(HTTPStatus.BAD_REQUEST, "classId and title are required"); return
        if not self.can_manage(user, data['classId']): return
        if not str(data['title']).strip(): raise ValueError('Assignment title is required')
        if not data.get('submissionTypes', ['file']): raise ValueError('Choose at least one submission type')
        assignment_id, created = data.get("id", uid()), timestamp(); due = data.get("dueAt", data.get("due", data.get("dueDate")))
        if due and len(str(due)) == 10: due = str(due) + "T23:59:59Z"
        if due:
            parsed = datetime.fromisoformat(str(due).replace('Z', '+00:00'))
            if parsed.tzinfo is None: parsed = parsed.replace(tzinfo=timezone.utc)
            due = parsed.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        with self.service.db.connection() as db:
            if not db.execute("SELECT id FROM classes WHERE id = ?", (data["classId"],)).fetchone(): self.error(HTTPStatus.NOT_FOUND, "Class not found"); return
            recipients = data.get('recipientIds', [])
            if not isinstance(recipients, list): raise ValueError('Recipients must be a list of student IDs')
            for student in recipients:
                if not db.execute("SELECT u.id FROM users u JOIN class_memberships m ON m.user_id=u.id WHERE u.id=? AND u.role='student' AND u.active=1 AND m.class_id=? AND m.removed_at IS NULL", (student, data['classId'])).fetchone(): raise ValueError('Recipients must be enrolled students')
            db.execute("INSERT INTO assignments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)", (assignment_id, data["classId"], user["id"], data["title"], data.get("description", ""), due, json.dumps(data.get("submissionTypes", data.get("allowedSubmissionTypes", ["file"]))), as_bool(data.get("allowLate")), as_bool(data.get("allowResubmission"), False), created, created))
            for student in set(recipients): db.execute('INSERT INTO assignment_recipients VALUES (?, ?)', (assignment_id, student))
        self.send_json(next(a for a in self.service.snapshot(user["id"])["assignments"] if a["id"] == assignment_id), HTTPStatus.CREATED)

    def attach_resource(self, assignment_id, data):
        user = self.require({'teacher', 'administrator'})
        if not user: return
        with self.service.db.connection() as db:
            assignment = db.execute('SELECT class_id FROM assignments WHERE id=?', (assignment_id,)).fetchone()
            if not assignment: self.error(404, 'Assignment not found'); return
            if not self.can_manage(user, assignment['class_id']): return
            upload = db.execute('SELECT * FROM uploads WHERE id=? AND owner_id=?', (data.get('id'), user['id'])).fetchone()
            if not upload: self.error(403, 'Upload access denied'); return
            resource_id = data.get('resourceId', upload['id'])
            existing = db.execute('SELECT assignment_id FROM assignment_resources WHERE id=?', (resource_id,)).fetchone()
            if existing:
                if existing['assignment_id'] != assignment_id: self.error(409, 'Resource ID already in use'); return
            else:
                path = self.service.settings.files_dir / upload['id']
                db.execute('INSERT INTO assignment_resources VALUES (?, ?, ?, ?, ?, ?, ?, ?)', (resource_id, assignment_id, upload['name'], 'files/' + upload['id'], upload['mime'], path.stat().st_size, hashlib.sha256(path.read_bytes()).hexdigest(), timestamp()))
        self.send_json({'id': resource_id}, 201)

    def create_event(self, data):
        user = self.require({"teacher", "administrator"})
        if not user: return
        if data.get('classId'):
            if not self.can_manage(user, data['classId']): return
        elif user['role'] != 'administrator': self.error(403, 'Only administrators create school-wide events'); return
        event_id, created = data.get("id", uid()), timestamp(); starts = data.get("startsAt") or (str(data.get("date", created[:10])) + "T" + str(data.get("time", "00:00")) + ":00Z")
        with self.service.db.connection() as db: db.execute("INSERT INTO calendar_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (event_id, data.get("classId"), user["id"], data.get("title", "Event"), data.get("description", data.get("notes", "")), data.get("eventType", data.get("kind", "school")), starts, data.get("endsAt"), data.get("assignmentId"), created))
        self.send_json({"id": event_id, "title": data.get("title", "Event"), "date": starts[:10], "time": starts[11:16], "notes": data.get("description", data.get("notes", "")), "kind": data.get("eventType", data.get("kind", "school")), "assignmentId": data.get("assignmentId")}, HTTPStatus.CREATED)

    def create_submission(self, data):
        user = self.require({"student", "teacher", "administrator"})
        if not user: return
        data['studentId'] = data.get('studentId', user['id']) if user['role'] in ('teacher', 'administrator') else user['id']
        with self.service.db.connection() as db:
            assignment = db.execute('SELECT * FROM assignments WHERE id=? AND active=1', (data.get('assignmentId'),)).fetchone()
            if not assignment: self.error(404, 'Assignment not found'); return
            if user['role'] in ('teacher', 'administrator') and not self.can_manage(user, assignment['class_id']): return
            if data.get('kind', 'file') not in json.loads(assignment['allowed_submission_types']): self.error(400, 'Submission type is not allowed'); return
            student_id = data['studentId']
            if not db.execute("SELECT u.id FROM users u JOIN class_memberships m ON m.user_id=u.id WHERE m.class_id=? AND u.id=? AND u.role='student' AND u.active=1 AND m.removed_at IS NULL", (assignment['class_id'], student_id)).fetchone(): self.error(403, 'Student enrollment required'); return
            recipients = [r['student_id'] for r in db.execute('SELECT student_id FROM assignment_recipients WHERE assignment_id=?', (assignment['id'],))]
            if recipients and student_id not in recipients: self.error(403, 'Assignment is not assigned to this student'); return
            existing = db.execute('SELECT * FROM submissions WHERE id=?', (data.get('id'),)).fetchone()
            if existing:
                if existing['student_id'] != student_id or existing['assignment_id'] != assignment['id']: self.error(403, 'Submission access denied'); return
                self.send_json({'id': existing['id']}); return
            previous = db.execute('SELECT status FROM submissions WHERE assignment_id=? AND student_id=? ORDER BY submitted_at DESC LIMIT 1', (assignment['id'], student_id)).fetchone()
            if not assignment['allow_resubmission'] and previous and previous['status'] != 'revision_requested': self.error(409, 'Resubmission is disabled'); return
            if not assignment['allow_late'] and assignment['due_at'] and assignment['due_at'] < timestamp(): self.error(409, 'Assignment is past due'); return
        submission_id, created, student_id = data.get("id", uid()), timestamp(), data.get("studentId", user["id"])
        with self.service.db.connection() as db:
            attempt = db.execute("SELECT COALESCE(MAX(attempt_number), 0) + 1 AS n FROM submissions WHERE assignment_id = ? AND student_id = ?", (data.get("assignmentId"), student_id)).fetchone()["n"]
            db.execute("INSERT INTO submissions (id, assignment_id, student_id, attempt_number, submitted_at, status, grade_value, grade_label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'uploading', NULL, NULL, ?, ?)", (submission_id, data.get("assignmentId"), student_id, attempt, created, created, created))
        self.send_json({"id": submission_id, "assignmentId": data.get("assignmentId"), "studentId": student_id, "submittedAt": created, "status": "uploading", "files": [], "feedback": [], "gradeValue": None, "gradeLabel": None}, HTTPStatus.CREATED)

    def attach_submission_file(self, submission_id, data):
        user = self.require({"student", "teacher", "administrator"})
        if not user: return
        with self.service.db.connection() as db:
            submission = db.execute('SELECT s.student_id, a.class_id FROM submissions s JOIN assignments a ON a.id=s.assignment_id WHERE s.id=?', (submission_id,)).fetchone()
            if not submission: self.error(404, 'Submission not found'); return
            if submission['student_id'] != user['id'] and not (user['role'] in ('teacher', 'administrator') and self.can_manage(user, submission['class_id'])): self.error(403, 'Submission access denied'); return
            existing_file = db.execute('SELECT id FROM submission_files WHERE submission_id=?', (submission_id,)).fetchone()
            if existing_file: self.send_json({'id': existing_file['id'], 'submissionId': submission_id}); return
            upload = db.execute('SELECT * FROM uploads WHERE id=? AND owner_id=?', (data.get('id'), user['id'])).fetchone()
            if not upload: self.error(403, 'Upload access denied'); return
        data['storageKey'] = 'files/' + upload['id']
        data['originalName'] = upload['name']
        data['mimeType'] = upload['mime']
        storage_key = str(data.get("storageKey", ""))
        if not storage_key or Path(storage_key).is_absolute() or ".." in Path(storage_key).parts:
            self.error(HTTPStatus.BAD_REQUEST, "A safe storageKey is required"); return
        target = self.service.settings.data_dir / storage_key
        if not target.is_file(): self.error(HTTPStatus.NOT_FOUND, "Uploaded file not found"); return
        with self.service.db.connection() as db:
            if not db.execute("SELECT id FROM submissions WHERE id = ?", (submission_id,)).fetchone(): self.error(HTTPStatus.NOT_FOUND, "Submission not found"); return
            file_id = data.get("id", uid())
            db.execute("INSERT INTO submission_files VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (file_id, submission_id, storage_key, Path(data.get("originalName", "upload.bin")).name, data.get("mimeType", "application/octet-stream"), int(data.get("sizeBytes", target.stat().st_size)), data.get("checksumSha256", hashlib.sha256(target.read_bytes()).hexdigest()), timestamp()))
            db.execute("UPDATE submissions SET status='submitted', updated_at=? WHERE id=? AND status='uploading'", (timestamp(), submission_id))
        self.send_json({"id": file_id, "submissionId": submission_id, "storageKey": storage_key}, HTTPStatus.CREATED)

    def grade(self, submission_id, data):
        teacher = self.require({"teacher", "administrator"})
        if not teacher: return
        value = data.get('gradeValue')
        if value is not None and (not isinstance(value, (int, float)) or not 0 <= value <= 100): self.error(400, 'Grade must be between 0 and 100'); return
        if data.get("status") not in ("graded", "returned", "revision_requested"): self.error(HTTPStatus.BAD_REQUEST, "Invalid submission status"); return
        with self.service.db.connection() as db:
            current = timestamp(); db.execute("UPDATE submissions SET status = ?, grade_value = ?, grade_label = ?, graded_at = ?, graded_by = ?, updated_at = ? WHERE id = ?", (data["status"], data.get("gradeValue"), data.get("gradeLabel"), current, teacher["id"], current, submission_id)); db.execute("INSERT INTO assignment_feedback VALUES (?, ?, ?, ?, ?)", (uid(), submission_id, teacher["id"], data.get("feedback", ""), current)); row = db.execute("SELECT s.*, u.display_name AS student_name FROM submissions s JOIN users u ON u.id = s.student_id WHERE s.id = ?", (submission_id,)).fetchone()
            if not row: self.error(HTTPStatus.NOT_FOUND, "Submission not found"); return
            result = self.submission_json(db, row)
        self.send_json(result)

    def enroll(self, class_id, data):
        if not self.require({"teacher", "administrator"}): return
        with self.service.db.connection() as db:
            if data.get('username'):
                student = db.execute("SELECT id FROM users WHERE username=? AND role='student' AND active=1", (str(data['username']).strip(),)).fetchone()
                if not student: self.error(404, 'Active student account not found. Check the username with your school administrator.'); return
                data['userId'] = student['id']
            if not db.execute("SELECT id FROM users WHERE id=? AND role='student' AND active=1", (data.get('userId'),)).fetchone(): self.error(400, 'Select an active student account'); return
            if not db.execute("SELECT id FROM classes WHERE id = ?", (class_id,)).fetchone() or not db.execute("SELECT id FROM users WHERE id = ?", (data.get("userId"),)).fetchone(): self.error(HTTPStatus.NOT_FOUND, "Class or user not found"); return
            db.execute("INSERT OR REPLACE INTO class_memberships VALUES (?, ?, 'student', ?, NULL)", (class_id, data["userId"], timestamp()))
        self.empty()

    def sync(self, data):
        user = self.require()
        if not user: return
        self.send_json({'accepted': [], 'rejected': [{'id': op.get('id'), 'reason': 'Use authenticated submission and file endpoints'} for op in data.get('operations', [])]}); return
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
        user = self.require()
        if not user: return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.error(HTTPStatus.BAD_REQUEST, "Invalid Content-Length")
            return
        content_type = self.headers.get("Content-Type", "")
        if length <= 0: self.error(400, 'Upload body is required'); return
        if length > self.service.settings.max_upload_bytes: self.error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "File is too large"); return
        if not content_type.startswith("multipart/form-data"): self.error(HTTPStatus.BAD_REQUEST, "Expected multipart/form-data"); return
        if "boundary=" not in content_type: self.error(HTTPStatus.BAD_REQUEST, "Multipart boundary is missing"); return
        raw = self.rfile.read(length)
        message = BytesParser(policy=policy.default).parsebytes((f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n").encode() + raw)
        item = next((part for part in message.iter_parts() if part.get_param("name", header="content-disposition") == "file"), None)
        if item is None: self.error(HTTPStatus.BAD_REQUEST, "A file field is required"); return
        upload_key = next((part.get_content().strip() for part in message.iter_parts() if part.get_param('name', header='content-disposition') == 'uploadId'), '')
        file_id = hashlib.sha256((user['id'] + ':' + upload_key).encode()).hexdigest() if upload_key else uid()
        target = self.service.settings.files_dir / file_id; digest, size = hashlib.sha256(), 0
        content = item.get_payload(decode=True) or b""
        if target.exists() and hashlib.sha256(target.read_bytes()).digest() != hashlib.sha256(content).digest(): self.error(409, 'Upload ID reused with different file contents'); return
        with target.open("wb") as output:
            output.write(content)
        size = len(content); digest.update(content)
        with self.service.db.connection() as db:
            db.execute('INSERT OR IGNORE INTO uploads VALUES (?, ?, ?, ?)', (file_id, user['id'], Path(item.get_filename() or 'upload.bin').name, item.get_content_type()))
        self.send_json({"id": file_id, "storageKey": str(target.relative_to(self.service.settings.data_dir)), "originalName": Path(item.get_filename() or "upload.bin").name, "mimeType": item.get_content_type() or "application/octet-stream", "sizeBytes": size, "checksumSha256": digest.hexdigest()}, HTTPStatus.CREATED)

    def download_file(self, file_id):
        user = self.require()
        if not user: return
        with self.service.db.connection() as db:
            upload = db.execute('SELECT * FROM uploads WHERE id=?', (file_id,)).fetchone()
            allowed = upload and upload['owner_id'] == user['id']
            teacher = db.execute('SELECT c.teacher_id, s.student_id FROM submission_files f JOIN submissions s ON s.id=f.submission_id JOIN assignments a ON a.id=s.assignment_id JOIN classes c ON c.id=a.class_id WHERE f.id=?', (file_id,)).fetchone()
            if teacher and teacher['student_id'] == user['id']: allowed = True
            resource = db.execute("SELECT a.id, a.class_id, c.teacher_id FROM assignment_resources r JOIN assignments a ON a.id=r.assignment_id JOIN classes c ON c.id=a.class_id WHERE r.storage_key=?", ('files/' + file_id,)).fetchone()
            if resource:
                recipients = [r['student_id'] for r in db.execute('SELECT student_id FROM assignment_recipients WHERE assignment_id=?', (resource['id'],))]
                enrolled = bool(db.execute('SELECT user_id FROM class_memberships WHERE class_id=? AND user_id=? AND removed_at IS NULL', (resource['class_id'], user['id'])).fetchone())
                allowed = allowed or resource['teacher_id'] == user['id'] or (enrolled and (not recipients or user['id'] in recipients))
            if not allowed and user['role'] != 'administrator' and not (teacher and teacher['teacher_id'] == user['id']): self.error(403, 'File access denied'); return
        if not file_id or Path(file_id).name != file_id:
            self.error(HTTPStatus.BAD_REQUEST, "Invalid file id"); return
        target = self.service.settings.files_dir / file_id
        if not target.is_file(): self.error(HTTPStatus.NOT_FOUND, "File not found"); return
        body = target.read_bytes()
        self.send_response(HTTPStatus.OK); self.send_header("Content-Type", upload['mime'] if upload else 'application/octet-stream'); self.send_header('X-Content-Type-Options', 'nosniff'); self.send_header("Content-Length", str(len(body))); self.cors_headers(); self.end_headers(); self.wfile.write(body)

    def can_manage(self, user, class_id):
        with self.service.db.connection() as db:
            row = db.execute('SELECT teacher_id FROM classes WHERE id=?', (class_id,)).fetchone()
        if row and (user['role'] == 'administrator' or row['teacher_id'] == user['id']): return True
        self.error(403, 'Class access denied')
        return False

    def create_backup(self):
        if not self.require({"administrator"}): return
        backup_id, created = uid(), timestamp(); archive = self.service.settings.data_dir / "backups" / (uid() + ".zip")
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
            temp = self.service.settings.data_dir / (backup_id + ".sqlite3"); source = sqlite3.connect(temp)
            with self.service.db.connection() as db: db.backup(source)
            source.close(); output.write(temp, "locallearn.sqlite3"); temp.unlink(missing_ok=True)
            for file in self.service.settings.files_dir.rglob("*"):
                if file.is_file(): output.write(file, file.relative_to(self.service.settings.data_dir).as_posix())
        size = archive.stat().st_size
        with self.service.db.connection() as db: db.execute("INSERT INTO backup_runs VALUES (?, ?, ?, 'complete', ?, ?)", (backup_id, str(archive), size, created, timestamp()))
        self.send_json({"id": backup_id, "createdAt": created, "status": "complete", "sizeBytes": size}, HTTPStatus.CREATED)

    def restore_backup(self, backup_id):
        if not self.require({"administrator"}): return
        with self.service.db.connection() as db: row = db.execute("SELECT archive_path FROM backup_runs WHERE id = ?", (backup_id,)).fetchone()
        if not row or not Path(row["archive_path"]).is_file(): self.error(HTTPStatus.NOT_FOUND, "Backup not found"); return
        with zipfile.ZipFile(row["archive_path"]) as archive:
            if any(Path(name).is_absolute() or ".." in Path(name).parts for name in archive.namelist()): self.error(HTTPStatus.BAD_REQUEST, "Unsafe backup archive"); return
            if archive.testzip() is not None: raise ValueError('Backup checksum validation failed')
            with self.service.db.connection() as db: current_sessions = [dict(row) for row in db.execute('SELECT * FROM sessions')]
            extracted = self.service.settings.data_dir / (backup_id + ".restore.sqlite3"); extracted.write_bytes(archive.read("locallearn.sqlite3"))
            Database(extracted, self.service.db.schema_path)
            source = sqlite3.connect(extracted)
            if source.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': source.close(); extracted.unlink(); raise ValueError('Backup database is damaged')
            with self.service.db.connection() as db:
                source.backup(db)
                db.execute('DELETE FROM sessions')
                for saved in current_sessions:
                    if db.execute('SELECT id FROM users WHERE id=?', (saved['user_id'],)).fetchone(): db.execute('INSERT INTO sessions VALUES (?, ?, ?)', (saved['token_hash'], saved['user_id'], saved['created_at']))
            source.close(); extracted.unlink(missing_ok=True)
            for name in archive.namelist():
                if name.startswith('files/') and not name.endswith('/'):
                    target = self.service.settings.data_dir / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(archive.read(name))
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
            entity = path.split("/")[-1]; mapping = {"name": "name", "description": "description", "room": "room", "term": "term", "sectionName": "section_name", "active": "active"}; fields, values = [], []
            for key, column in mapping.items():
                if key in data: fields.append(column + " = ?"); values.append(as_bool(data[key]) if key == "active" else data[key])
            if fields: values.extend([timestamp(), entity]);
            if fields:
                with self.service.db.connection() as db: db.execute("UPDATE classes SET " + ", ".join(fields) + ", updated_at = ? WHERE id = ?", values)
            self.send_json(next((c for c in self.service.snapshot(self.service.user_for_token(self.auth_token())['id'])["classes"] if c["id"] == entity), {})); return
        if path.startswith("/api/assignments/"):
            if not self.require({"teacher", "administrator"}): return
            entity = path.split("/")[-1]; mapping = {"title": "title", "description": "description", "dueAt": "due_at", "dueDate": "due_at", "active": "active"}; fields, values = [], []
            for key, column in mapping.items():
                if key in data: fields.append(column + " = ?"); values.append(as_bool(data[key]) if key == "active" else data[key])
            if fields: values.extend([timestamp(), entity]);
            if fields:
                with self.service.db.connection() as db: db.execute("UPDATE assignments SET " + ", ".join(fields) + ", updated_at = ? WHERE id = ?", values)
            self.send_json(next((a for a in self.service.snapshot(self.service.user_for_token(self.auth_token())['id'])["assignments"] if a["id"] == entity), {})); return
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


def secured(method):
    """Check object ownership before dispatch, including direct API requests."""
    def dispatch(self):
        path = urlparse(self.path).path.rstrip('/')
        if path == '/api/admin/health':
            self.send_json({'status': 'ok', 'database': 'sqlite'}); return
        if self.command == 'GET' and not path.startswith('/api/'): return method(self)
        if path == '/api/auth/login' and self.command == 'POST':
            return method(self)
        user = self.require()
        if not user: return
        try:
            with self.service.db.connection() as db:
                if path.startswith('/api/admin/') and user['role'] != 'administrator':
                    self.error(403, 'Administrator access required'); return
                parts = path.split('/')
                class_id = None
                if len(parts) > 3 and parts[2] == 'classes': class_id = parts[3]
                if len(parts) > 3 and parts[2] == 'assignments':
                    row = db.execute('SELECT class_id FROM assignments WHERE id = ?', (parts[3],)).fetchone()
                    if row: class_id = row['class_id']
                if len(parts) > 3 and parts[2] == 'submissions':
                    row = db.execute('SELECT s.*, a.class_id FROM submissions s JOIN assignments a ON a.id=s.assignment_id WHERE s.id=?', (parts[3],)).fetchone()
                    if not row: self.error(404, 'Submission not found'); return
                    class_id = row['class_id']
                    if user['role'] == 'student' and (row['student_id'] != user['id'] or parts[-1] == 'grade'):
                        self.error(403, 'Submission access denied'); return
                if class_id and user['role'] != 'administrator':
                    owned = db.execute('SELECT id FROM classes WHERE id=? AND teacher_id=?', (class_id, user['id'])).fetchone()
                    enrolled = db.execute('SELECT user_id FROM class_memberships WHERE class_id=? AND user_id=? AND removed_at IS NULL', (class_id, user['id'])).fetchone()
                    if not owned and not (user['role'] == 'student' and enrolled and parts[2] == 'submissions'):
                        self.error(403, 'Class access denied'); return
            if self.command in ('POST', 'PATCH', 'DELETE') and self.headers.get('Content-Type', '').startswith('application/json'):
                length = int(self.headers.get('Content-Length', '0'))
                if length < 0 or length > self.service.settings.max_upload_bytes: raise ValueError('Invalid request size')
                raw = self.rfile.read(length)
                self.rfile = io.BytesIO(raw)
                payload = json.loads(raw or '{}')
                operation_id = payload.get('id')
                if operation_id:
                    digest = hashlib.sha256((self.command + path + json.dumps(payload, sort_keys=True)).encode()).hexdigest()
                    with self.service.db.connection() as db:
                        row = db.execute('SELECT * FROM mutation_receipts WHERE user_id=? AND operation_id=?', (user['id'], operation_id)).fetchone()
                    if row:
                        if row['payload_hash'] != digest: self.error(409, 'Operation ID reused with different data'); return
                        receipt = json.loads(row['response']); self.send_json(receipt['payload'], receipt['status']); return
                    self.mutation_receipt = (user['id'], operation_id, digest)
            return method(self)
        except (ValueError, TypeError, sqlite3.IntegrityError) as exc:
            self.error(400, str(exc))
        except Exception:
            traceback.print_exc(); self.error(500, 'Request processing failed')
    return dispatch


for verb in ('GET', 'POST', 'PATCH', 'DELETE'):
    setattr(Handler, 'do_' + verb, secured(getattr(Handler, 'do_' + verb)))


def main():
    parser = argparse.ArgumentParser(description="LocalLearn SQLite server for Raspberry Pi")
    parser.add_argument("--host", default=None); parser.add_argument("--port", type=int, default=None); args = parser.parse_args()
    defaults = Settings(); settings = Settings(host=args.host or defaults.host, port=args.port or defaults.port, data_dir=defaults.data_dir, max_upload_bytes=defaults.max_upload_bytes)
    server = ThreadingHTTPServer((settings.host, settings.port), Handler); server.service = LocalLearnServer(settings)
    print(f"LocalLearn server listening on http://{settings.host}:{settings.port}"); server.serve_forever()

