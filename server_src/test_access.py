"""Exercise authentication, class isolation, file review and grade delivery."""
import json
import tempfile
import threading
import unittest
import sqlite3
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
from .app import Handler, LocalLearnServer, timestamp
from .config import Settings
from .security import hash_password


class AccessTest(unittest.TestCase):
    def test_upgrade_preserves_existing_classes_and_sessions(self):
        with tempfile.TemporaryDirectory() as folder:
            settings = Settings(data_dir=Path(folder))
            with sqlite3.connect(settings.database_path) as db:
                db.executescript(Path(__file__).with_name('schema.sql').read_text(encoding='utf8'))
                db.executescript((Path(__file__).parent / 'migrations' / '002_persistent_login.sql').read_text(encoding='utf8'))
                db.execute('CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
                db.execute("INSERT INTO schema_migrations(version) VALUES ('001_initial_schema'), ('002_persistent_login')")
                now = timestamp()
                db.execute('INSERT INTO users VALUES (?, ?, ?, ?, ?, 1, ?, ?)', ('teacher', 'teacher', 'Teacher', hash_password('password'), 'teacher', now, now))
                db.execute("INSERT INTO classes VALUES ('existing', 'Existing class', '', 'teacher', '', '', 1, ?, ?)", (now, now))
                db.execute("INSERT INTO sessions VALUES ('saved-token-hash', 'teacher', ?)", (now,))
            db.close()
            service = LocalLearnServer(settings)
            with service.db.connection() as db:
                self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 3)
                self.assertIsNone(db.execute("SELECT section_name FROM classes WHERE id='existing'").fetchone()[0])
                self.assertEqual(db.execute('SELECT COUNT(*) FROM assignment_recipients').fetchone()[0], 0)
                self.assertEqual(db.execute('SELECT token_hash FROM sessions').fetchone()[0], 'saved-token-hash')

    def test_student_teacher_workflow(self):
        with tempfile.TemporaryDirectory() as folder:
            service = LocalLearnServer(Settings(data_dir=Path(folder)))
            with service.db.connection() as db:
                for name, role in [('admin', 'administrator'), ('teacher', 'teacher'), ('other', 'teacher'), ('student', 'student'), ('peer', 'student')]:
                    db.execute('INSERT INTO users VALUES (?, ?, ?, ?, ?, 1, ?, ?)', (name, name, name, hash_password('password'), role, timestamp(), timestamp()))
            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler); server.service = service
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            base = f'http://127.0.0.1:{server.server_port}'
            def call(path, data=None, token=None, verb=None, raw=None, content='application/json'):
                headers = {'Content-Type': content}
                if token: headers['Authorization'] = 'Bearer ' + token
                request = Request(base + path, data=raw if raw is not None else json.dumps(data).encode() if data is not None else None, headers=headers, method=verb)
                try:
                    with urlopen(request) as response:
                        body = response.read()
                        return response.status, json.loads(body) if body and response.headers.get_content_type() == 'application/json' else body
                except HTTPError as e:
                    status, payload = e.code, e.read(); e.close(); return status, payload
            try:
                self.assertEqual(call('/api/snapshot')[0], 401)
                tokens = {name: call('/api/auth/login', {'username': name, 'password': 'password'})[1]['token'] for name in ['admin', 'teacher', 'other', 'student', 'peer']}
                self.assertEqual(call('/api/admin/overview', token=tokens['student'])[0], 403)
                self.assertGreaterEqual(call('/api/admin/overview', token=tokens['admin'])[1]['health']['storage']['freeBytes'], 0)
                status, school = call('/api/classes', {'name': 'Math', 'teacherId': 'teacher', 'sectionName': 'Morning'}, tokens['admin'])
                self.assertEqual(status, 201, school)
                self.assertEqual(school['sectionName'], 'Morning')
                self.assertEqual(call(f"/api/classes/{school['id']}/members", {'userId': 'student'}, tokens['admin'])[0], 204)
                members_path = f"/api/classes/{school['id']}/members"
                self.assertEqual(call(members_path, {'username': 'peer'}, tokens['other'])[0], 403)
                self.assertEqual(call(members_path, {'username': 'peer'}, tokens['student'])[0], 403)
                self.assertEqual(call(members_path, {'username': 'peer'}, tokens['teacher'])[0], 204)
                roster = call(members_path, token=tokens['teacher'])[1]
                self.assertEqual({row['username'] for row in roster}, {'student', 'peer'})
                self.assertTrue(all('password_hash' not in row for row in roster))
                self.assertEqual(call(members_path, {'username': 'teacher'}, tokens['teacher'])[0], 404)
                self.assertEqual(call(members_path + '/peer', token=tokens['teacher'], verb='DELETE')[0], 204)
                status, assignment = call('/api/assignments', {'classId': school['id'], 'title': 'Homework'}, tokens['teacher'])
                self.assertEqual(status, 201, assignment)
                draft = {'id': 'offline-assignment', 'classId': school['id'], 'title': 'Offline worksheet', 'description': 'Show your work', 'dueAt': '2027-01-20T18:30:00Z', 'submissionTypes': ['file'], 'allowLate': False, 'allowResubmission': True}
                self.assertEqual(call('/api/assignments', draft, tokens['teacher'])[0], 201)
                self.assertEqual(call('/api/assignments', draft, tokens['teacher'])[0], 201)
                self.assertEqual(call('/api/assignments', {**draft, 'title': 'Conflicting retry'}, tokens['teacher'])[0], 409)
                body = b'--resource\r\nContent-Disposition: form-data; name="file"; filename="worksheet.txt"\r\nContent-Type: text/plain\r\n\r\nWorksheet instructions\r\n--resource--\r\n'
                status, resource = call('/api/files/upload', token=tokens['teacher'], raw=body, content='multipart/form-data; boundary=resource')
                self.assertEqual(status, 201)
                self.assertEqual(call('/api/assignments/offline-assignment/resources', {**resource, 'resourceId': 'worksheet'}, tokens['teacher'])[0], 201)
                self.assertEqual(call('/api/files/' + resource['id'], token=tokens['student']), (200, b'Worksheet instructions'))
                self.assertEqual(call('/api/files/' + resource['id'], token=tokens['peer'])[0], 403)
                record = next(a for a in call('/api/snapshot', token=tokens['student'])[1]['assignments'] if a['id'] == 'offline-assignment')
                self.assertEqual(record['description'], 'Show your work'); self.assertEqual(record['dueAt'], '2027-01-20T18:30:00.000Z')
                self.assertEqual(record['resources'][0]['id'], resource['id'])
                # Tokens remain valid across a server restart; logout still revokes them.
                with server.service.db.connection() as db:
                    db.execute("UPDATE sessions SET created_at='2000-01-01T00:00:00Z'")
                server.service = LocalLearnServer(Settings(data_dir=Path(folder)))
                self.assertEqual(call('/api/snapshot', token=tokens['student'])[0], 200)
                self.assertEqual(call('/api/snapshot', token=tokens['peer'])[1]['assignments'], [])
                status, submission = call('/api/submissions', {'assignmentId': assignment['id'], 'studentId': 'peer'}, tokens['student'])
                self.assertEqual(status, 201, submission)
                self.assertEqual(submission['studentId'], 'student')
                self.assertEqual(submission['status'], 'uploading')
                self.assertEqual(call(f"/api/assignments/{assignment['id']}/submissions", token=tokens['teacher'])[1], [])
                incomplete = next(a for a in call('/api/snapshot', token=tokens['student'])[1]['assignments'] if a['id'] == assignment['id'])
                self.assertFalse(incomplete['completed']); self.assertNotIn('submittedAt', incomplete)
                body = b'--test\r\nContent-Disposition: form-data; name="file"; filename="work.txt"\r\nContent-Type: text/plain\r\n\r\nMy original work\r\n--test--\r\n'
                status, upload = call('/api/files/upload', token=tokens['student'], raw=body, content='multipart/form-data; boundary=test')
                self.assertEqual(status, 201, upload)
                self.assertEqual(call(f"/api/submissions/{submission['id']}/files", upload, tokens['student'])[0], 201)
                self.assertEqual(len(call(f"/api/assignments/{assignment['id']}/submissions", token=tokens['teacher'])[1]), 1)
                complete = next(a for a in call('/api/snapshot', token=tokens['student'])[1]['assignments'] if a['id'] == assignment['id'])
                self.assertTrue(complete['completed']); self.assertEqual(complete['submissionStatus'], 'submitted')
                self.assertEqual(call('/api/files/' + upload['id'], token=tokens['teacher']), (200, b'My original work'))
                self.assertEqual(call('/api/files/' + upload['id'], token=tokens['peer'])[0], 403)
                self.assertEqual(call('/api/files/' + upload['id'], token=tokens['other'])[0], 403)
                grade = {'status': 'graded', 'gradeValue': 92, 'feedback': 'Well done'}
                path = f"/api/submissions/{submission['id']}/grade"
                self.assertEqual(call(path, grade, tokens['student'])[0], 403)
                self.assertEqual(call(path, grade, tokens['other'])[0], 403)
                self.assertEqual(call(path, grade, tokens['teacher'])[0], 200)
                receipt = next(a for a in call('/api/snapshot', token=tokens['student'])[1]['assignments'] if a['id'] == assignment['id'])
                self.assertEqual(receipt['grade'], 92); self.assertEqual(receipt['feedback'], 'Well done')
                quiz = call('/api/quizzes', {'classId': school['id'], 'title': 'Quiz', 'questions': [{'prompt': '2+2?', 'type': 'multiple_choice', 'options': ['4', '5'], 'correctAnswer': '4', 'points': 1}]}, tokens['teacher'])[1]
                q = call('/api/snapshot', token=tokens['student'])[1]['quizzes'][0]['questions'][0]
                self.assertIsNone(q['correctAnswer'])
                attempt = {'quizId': quiz['id'], 'answers': {q['id']: '4'}, 'score': 100}
                status, result = call('/api/quiz-attempts', attempt, tokens['student'])
                self.assertEqual(status, 201, result); self.assertEqual(result['score'], 1)
                self.assertEqual(call('/api/quiz-attempts', attempt, tokens['peer'])[0], 403)
                self.assertEqual(call('/api/quiz-attempts', attempt, tokens['student'])[1]['id'], result['id'])
                self.assertEqual(call('/api/quizzes', {'classId': school['id'], 'title': 'Empty', 'questions': []}, tokens['teacher'])[0], 400)
                mixed = {'id': 'mixed-quiz', 'classId': school['id'], 'title': 'Written and true/false', 'dueAt': '2027-01-20T01:00:00Z', 'questions': [
                    {'id': 'true-false', 'prompt': 'The earth is round', 'type': 'multiple_choice', 'options': ['True', 'False'], 'correctAnswer': 'True', 'points': 1},
                    {'id': 'written', 'prompt': 'Explain', 'type': 'short_answer', 'points': 2},
                ]}
                self.assertEqual(call('/api/quizzes', mixed, tokens['teacher'])[0], 201)
                self.assertEqual(call('/api/quizzes', mixed, tokens['teacher'])[0], 201)
                synced_quiz = next(q for q in call('/api/snapshot', token=tokens['student'])[1]['quizzes'] if q['id'] == 'mixed-quiz')
                self.assertEqual(synced_quiz['dueAt'], mixed['dueAt']); self.assertEqual(synced_quiz['questions'][0]['id'], 'true-false')
                written_attempt = call('/api/quiz-attempts', {'quizId': 'mixed-quiz', 'answers': {'true-false': 'True', 'written': 'My explanation'}}, tokens['student'])[1]
                self.assertEqual(written_attempt['status'], 'ungraded'); self.assertIsNone(written_attempt['score'])
                review_path = '/api/quiz-attempts/' + written_attempt['id'] + '/grade'
                self.assertEqual(call(review_path, {'score': 3}, tokens['other'])[0], 403)
                self.assertEqual(call(review_path, {'score': 3}, tokens['teacher'])[0], 200)
                graded_attempt = next(a for a in call('/api/snapshot', token=tokens['student'])[1]['quizAttempts'] if a['id'] == written_attempt['id'])
                self.assertEqual(graded_attempt['status'], 'graded'); self.assertEqual(graded_attempt['score'], 3)
                # Individual recipients remain private even from other enrolled students.
                self.assertEqual(call(members_path, {'username': 'peer'}, tokens['teacher'])[0], 204)
                targeted = {'id': 'targeted', 'classId': school['id'], 'title': 'Individual worksheet', 'recipientIds': ['student'], 'submissionTypes': ['file']}
                self.assertEqual(call('/api/assignments', targeted, tokens['teacher'])[0], 201)
                self.assertNotIn('targeted', [a['id'] for a in call('/api/snapshot', token=tokens['peer'])[1]['assignments']])
                self.assertEqual(call('/api/submissions', {'assignmentId': 'targeted'}, tokens['peer'])[0], 403)
                self.assertEqual(call('/api/assignments', {**targeted, 'id': 'invalid-target', 'recipientIds': ['other']}, tokens['teacher'])[0], 400)
                status, teacher_file = call('/api/files/upload', token=tokens['teacher'], raw=body, content='multipart/form-data; boundary=test')
                self.assertEqual(status, 201)
                self.assertEqual(call('/api/assignments/targeted/resources', {**teacher_file, 'resourceId': 'private-resource'}, tokens['teacher'])[0], 201)
                self.assertEqual(call('/api/files/' + teacher_file['id'], token=tokens['peer'])[0], 403)
                self.assertEqual(call('/api/files/' + teacher_file['id'], token=tokens['student'])[0], 200)
                # The assigned teacher can submit student work; another teacher cannot.
                assisted = {'id': 'assisted', 'assignmentId': 'targeted', 'studentId': 'student', 'kind': 'file'}
                self.assertEqual(call('/api/submissions', assisted, tokens['other'])[0], 403)
                status, assisted_receipt = call('/api/submissions', assisted, tokens['teacher'])
                self.assertEqual(status, 201, assisted_receipt); self.assertEqual(assisted_receipt['studentId'], 'student')
                status, assisted_file = call('/api/files/upload', token=tokens['teacher'], raw=body, content='multipart/form-data; boundary=test')
                self.assertEqual(status, 201)
                self.assertEqual(call('/api/submissions/assisted/files', assisted_file, tokens['teacher'])[0], 201)
                self.assertEqual(call('/api/files/' + assisted_file['id'], token=tokens['student'])[0], 200)
                self.assertEqual(call('/api/submissions/assisted/grade', {'gradeLabel': 'B+', 'feedback': 'Good work', 'status': 'returned'}, tokens['teacher'])[0], 200)
                assisted_result = next(a for a in call('/api/snapshot', token=tokens['student'])[1]['assignments'] if a['id'] == 'targeted')
                self.assertEqual(assisted_result['gradeLabel'], 'B+'); self.assertTrue(assisted_result['completed'])
                self.assertEqual(call('/api/submissions', {'assignmentId': 'targeted'}, tokens['student'])[0], 409)
                overdue = {'id': 'overdue', 'classId': school['id'], 'title': 'Past due', 'dueAt': '2000-01-01T00:00:00Z', 'allowLate': False}
                self.assertEqual(call('/api/assignments', overdue, tokens['teacher'])[0], 201)
                self.assertEqual(call('/api/submissions', {'assignmentId': 'overdue'}, tokens['student'])[0], 409)
                self.assertEqual(call('/api/admin/users/student', {'active': False}, tokens['admin'], verb='PATCH')[0], 200)
                self.assertEqual(call('/api/snapshot', token=tokens['student'])[0], 401)
                self.assertEqual(call('/api/admin/users/student', {'active': True}, tokens['admin'], verb='PATCH')[0], 200)
                self.assertEqual(call('/api/snapshot', token=tokens['student'])[0], 200)
                status, event = call('/api/calendar/events', {'classId': school['id'], 'title': 'Class gathering', 'startsAt': '2027-01-12T12:00:00Z', 'eventType': 'class'}, tokens['teacher'])
                self.assertEqual(status, 201, event)
                status, backup = call('/api/admin/backups', {}, tokens['admin'])
                self.assertEqual(status, 201, backup)
                file_path = Path(folder) / 'files' / resource['id']
                file_path.write_text('damaged content', encoding='utf8')
                self.assertEqual(call('/api/admin/backups/' + backup['id'] + '/restore', {}, tokens['admin'])[0], 200)
                self.assertEqual(call('/api/files/' + resource['id'], token=tokens['student']), (200, b'Worksheet instructions'))
                call('/api/auth/logout', {}, tokens['student'])
                self.assertEqual(call('/api/snapshot', token=tokens['student'])[0], 401)
            finally:
                server.shutdown(); server.server_close(); thread.join()


if __name__ == '__main__': unittest.main()
