"""Exercise authentication, class isolation, file review and grade delivery."""
import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
from .app import Handler, LocalLearnServer, timestamp
from .config import Settings
from .security import hash_password


class AccessTest(unittest.TestCase):
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
                status, school = call('/api/classes', {'name': 'Math', 'teacherId': 'teacher'}, tokens['admin'])
                self.assertEqual(status, 201, school)
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
                self.assertEqual(call('/api/snapshot', token=tokens['peer'])[1]['assignments'], [])
                status, submission = call('/api/submissions', {'assignmentId': assignment['id'], 'studentId': 'peer'}, tokens['student'])
                self.assertEqual(status, 201, submission)
                self.assertEqual(submission['studentId'], 'student')
                body = b'--test\r\nContent-Disposition: form-data; name="file"; filename="work.txt"\r\nContent-Type: text/plain\r\n\r\nMy original work\r\n--test--\r\n'
                status, upload = call('/api/files/upload', token=tokens['student'], raw=body, content='multipart/form-data; boundary=test')
                self.assertEqual(status, 201, upload)
                self.assertEqual(call(f"/api/submissions/{submission['id']}/files", upload, tokens['student'])[0], 201)
                self.assertEqual(call('/api/files/' + upload['id'], token=tokens['teacher']), (200, b'My original work'))
                self.assertEqual(call('/api/files/' + upload['id'], token=tokens['peer'])[0], 403)
                self.assertEqual(call('/api/files/' + upload['id'], token=tokens['other'])[0], 403)
                grade = {'status': 'graded', 'gradeValue': 92, 'feedback': 'Well done'}
                path = f"/api/submissions/{submission['id']}/grade"
                self.assertEqual(call(path, grade, tokens['student'])[0], 403)
                self.assertEqual(call(path, grade, tokens['other'])[0], 403)
                self.assertEqual(call(path, grade, tokens['teacher'])[0], 200)
                receipt = call('/api/snapshot', token=tokens['student'])[1]['assignments'][0]
                self.assertEqual(receipt['grade'], 92); self.assertEqual(receipt['feedback'], 'Well done')
                quiz = call('/api/quizzes', {'classId': school['id'], 'title': 'Quiz', 'questions': [{'prompt': '2+2?', 'type': 'multiple_choice', 'options': ['4', '5'], 'correctAnswer': '4', 'points': 1}]}, tokens['teacher'])[1]
                q = call('/api/snapshot', token=tokens['student'])[1]['quizzes'][0]['questions'][0]
                self.assertIsNone(q['correctAnswer'])
                attempt = {'quizId': quiz['id'], 'answers': {q['id']: '4'}, 'score': 100}
                status, result = call('/api/quiz-attempts', attempt, tokens['student'])
                self.assertEqual(status, 201, result); self.assertEqual(result['score'], 1)
                self.assertEqual(call('/api/quiz-attempts', attempt, tokens['peer'])[0], 403)
                self.assertEqual(call('/api/quiz-attempts', attempt, tokens['student'])[1]['id'], result['id'])
                call('/api/auth/logout', {}, tokens['student'])
                self.assertEqual(call('/api/snapshot', token=tokens['student'])[0], 401)
            finally:
                server.shutdown(); server.server_close(); thread.join()


if __name__ == '__main__': unittest.main()
