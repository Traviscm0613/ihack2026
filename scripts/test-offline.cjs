const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules, globals = {}) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText;
  const context = {exports: {}, require: name => {if (!(name in modules)) throw Error(`Unexpected dependency ${name}`); return modules[name];}, fetch, FormData, Blob, AbortController, TextEncoder, TextDecoder, Uint8Array, process: {env: {}}, setTimeout, clearTimeout, console, ...globals};
  vm.runInNewContext(output, context, {filename: file});
  return context.exports;
}

test('an offline teacher assignment retains its ID and attachments until a successful retry', async () => {
  let offline = true;
  const pending = [{id: 'operation-1', type: 'mutation', payload: {path: '/api/assignments', method: 'POST', body: {id: 'assignment-1', title: 'Worksheet', __files: [{id: 'resource-1', uri: 'data:text/plain,Worksheet', name: 'worksheet.txt', type: 'text/plain'}]}}}];
  const failures = [], calls = [];
  const db = {getPendingChanges: async () => [...pending], recordPendingChangeFailure: async (id, error) => failures.push({id, error}), removePendingChange: async id => pending.splice(pending.findIndex(p => p.id === id), 1), accountScope: () => 'student-1', acknowledgeSubmission: async () => {}};
  const {LocalSyncQueue} = load('src/services/syncQueue.ts', {'../db/database': db, 'react-native': {Platform: {OS: 'web'}}});
  const queue = new LocalSyncQueue();
  const client = {replay: async (path, body) => {calls.push({path, body}); if (offline) throw Error('Offline');}, upload: async form => {assert.equal(await form.get('file').text(), 'Worksheet'); return {id: 'upload-1'};}};
  const failed = await queue.flush(client);
  assert.equal(failed.accepted.length, 0); assert.equal(pending.length, 1); assert.equal(failures.length, 1);
  offline = false;
  const result = await queue.flush(client);
  assert.equal(result.accepted[0], 'operation-1'); assert.equal(pending.length, 0);
  assert.equal(calls[0].body.id, calls[1].body.id);
  assert.equal(calls[2].path, '/api/assignments/assignment-1/resources');
  assert.equal(calls[2].body.resourceId, 'resource-1');
});

test('due dates reject overflowing dates and default an optional time to the end of the day', () => {
  const {assignmentDueDate} = load('src/services/assignmentDates.ts', {});
  assert.throws(() => assignmentDueDate('2027-02-30', '12:00'));
  assert.throws(() => assignmentDueDate('2027-01-20', '24:01'));
  const due = new Date(assignmentDueDate('2027-01-20', ''));
  assert.equal(due.getDate(), 20); assert.equal(due.getHours(), 23); assert.equal(due.getMinutes(), 59);
});

test('encryption initializes without browser randomness and preserves its key across a restart', () => {
  const isolated = {exports: {}};
  vm.runInNewContext(fs.readFileSync(require.resolve('tweetnacl'), 'utf8'), {module: isolated, exports: isolated.exports, require: () => ({}), Uint8Array, Uint32Array, Int32Array, Float64Array});
  const nacl = isolated.exports;
  assert.throws(() => nacl.randomBytes(24), /no PRNG/);
  let randomCalls = 0;
  const protection = load('src/services/dataProtection.ts', {tweetnacl: {default: nacl}, 'expo-crypto': {getRandomValues: bytes => {randomCalls++; return require('node:crypto').randomFillSync(bytes);}}});
  protection.configureDataProtection('student:password');
  const protectedData = protection.protectJson({answer: 'My work'});
  const key = protection.exportProtectionKey();
  assert.equal(randomCalls, 1);
  protection.configureDataProtection('different account');
  assert.throws(() => protection.unprotectJson(protectedData), /could not be decrypted/);
  protection.restoreProtectionKey(key);
  assert.equal(protection.unprotectJson(protectedData).answer, 'My work');
});

function apiModule(db, platform, fileSystem = {}, globals = {}) {
  return load('src/services/serverApi.ts', {
    '../db/database': db,
    './dataProtection': {}, './sessionStorage': {},
    'expo-file-system/legacy': fileSystem, 'react-native': {Platform: {OS: platform}},
  }, globals);
}

test('sync waits for resource bytes, then the cached document opens without the Pi', async () => {
  const values = new Map(); let offline = false; let downloaded = false;
  class Reader {
    readAsDataURL(blob) {blob.arrayBuffer().then(bytes => {this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`; downloaded = true; this.onload();});}
  }
  const snapshot = {assignments: [{resources: [{id: 'worksheet', name: 'worksheet.txt'}]}]};
  const {LocalServerClient} = apiModule({accountScope: () => 'student', cachedValue: async key => values.get(key) ?? null, cacheValue: async (key, value) => values.set(key, value)}, 'web', {}, {
    FileReader: Reader,
    fetch: async (url, init) => {
      if (url.startsWith('data:')) return fetch(url);
      if (offline) throw Error('Pi disconnected');
      assert.equal(init.headers.Authorization, 'Bearer token');
      return url.endsWith('/api/snapshot') ? {ok: true, json: async () => snapshot} : {ok: true, blob: async () => new Blob(['Worksheet'], {type: 'text/plain'})};
    },
  });
  const client = new LocalServerClient('http://school:9000', 'token');
  await client.snapshot(); assert.equal(downloaded, true);
  offline = true;
  assert.equal(await (await client.file('worksheet')).text(), 'Worksheet');
});

test('a failed resource download remains visible for retry while other documents still download', async () => {
  const attempted = [];
  const {LocalServerClient} = apiModule({accountScope: () => 'student', cachedValue: async () => null, cacheValue: async () => {}}, 'web', {}, {
    fetch: async url => {
      if (url.endsWith('/api/snapshot')) return {ok: true, json: async () => ({assignments: [{resources: [{id: 'bad', name: 'bad.txt'}, {id: 'good', name: 'good.txt'}]}]})};
      attempted.push(url);
      return {ok: !url.endsWith('/bad'), status: 503, blob: async () => new Blob(['good'])};
    },
  });
  const client = new LocalServerClient('http://school:9000');
  const snapshot = await client.snapshot();
  assert.equal(snapshot.assignments.length, 1); assert.equal(attempted.length, 2);
  assert.match(client.downloadError, /bad.txt/);
});

test('native downloads are scoped to the account and failed transfers never become cached documents', async () => {
  let status = 403; let calls = 0;
  const files = new Map();
  const fileSystem = {
    documentDirectory: 'file:///documents/', makeDirectoryAsync: async () => {},
    getInfoAsync: async uri => ({exists: files.has(uri)}),
    getContentUriAsync: async uri => 'content:' + uri,
    downloadAsync: async (url, uri) => {calls++; files.set(uri, status === 200 ? 'worksheet' : 'access denied'); return {uri, status};},
    moveAsync: async ({from, to}) => {files.set(to, files.get(from)); files.delete(from);},
    deleteAsync: async uri => files.delete(uri),
  };
  const {LocalServerClient} = apiModule({accountScope: () => 'student', accountStorageName: () => 'student.db'}, 'android', fileSystem);
  const client = new LocalServerClient('http://school:9000');
  await assert.rejects(client.downloadFile('resource', 'worksheet.txt'));
  assert.equal(files.size, 0);
  status = 200;
  const uri = await client.downloadFile('resource', 'worksheet.txt');
  assert.match(uri, /classroom-files\/student.db\//);
  await client.downloadFile('resource', 'worksheet.txt'); assert.equal(calls, 2);
});

test('clients created before sign-out cannot read or send the next account’s data', async () => {
  let scope = 'student:1'; let calls = 0;
  const {LocalServerClient} = apiModule({accountScope: () => scope}, 'web', {}, {fetch: async () => {calls++; throw Error('Should not contact Pi');}});
  const client = new LocalServerClient('http://school:9000');
  scope = 'student:2';
  await assert.rejects(client.snapshot(), /Account changed/);
  await assert.rejects(client.file('resource'), /Account changed/);
  assert.equal(calls, 0);
});

test('production web discovery uses the HTTPS origin serving the app', () => {
  const api = apiModule({accountScope: () => 'student'}, 'web', {}, {process: {env: {NODE_ENV: 'production'}}, location: {origin: 'https://school.local'}});
  assert.equal(api.getConfiguredServerUrl(), 'https://school.local');
  assert.equal(new api.LocalServerClient().baseUrl, 'https://school.local');
  assert.equal(api.getConfiguredServerUrls()[0], 'https://school.local');
});

test('a cached snapshot preserves queued completion, document metadata, and immutable quiz attempts', async () => {
  const {DatabaseSync} = require('node:sqlite');
  const sql = new DatabaseSync(':memory:');
  const adapter = {
    execAsync: async query => sql.exec(query),
    runAsync: async (query, ...args) => sql.prepare(query).run(...args),
    getFirstAsync: async (query, ...args) => sql.prepare(query).get(...args) ?? null,
    getAllAsync: async (query, ...args) => sql.prepare(query).all(...args),
    withTransactionAsync: async action => {sql.exec('BEGIN'); try {await action(); sql.exec('COMMIT');} catch (error) {sql.exec('ROLLBACK'); throw error;}},
  };
  const nacl = require('tweetnacl');
  const protection = load('src/services/dataProtection.ts', {tweetnacl: {default: nacl}, 'expo-crypto': {getRandomValues: bytes => require('node:crypto').randomFillSync(bytes)}});
  const db = load('src/db/database.ts', {
    'expo-sqlite': {openDatabaseAsync: async () => adapter}, tweetnacl: {default: nacl},
    '../data/mockData': {}, '../services/dataProtection': protection, '../services/serverApi': {},
  });
  try {
    await db.initializeDatabase();
    const assignment = {id: 'work', classId: 'class', title: 'Worksheet', subject: 'Math', teacher: 'Teacher', due: '2027-01-20', dueDate: '2027-01-20', dueAt: '2027-01-20T18:30:00Z', description: 'Instructions', completed: false, tone: 'math', submissionTypes: ['file'], grade: null, feedback: null, resources: [{id: 'resource', name: 'worksheet.txt', mimeType: 'text/plain'}]};
    const quiz = {id: 'quiz', classId: 'class', title: 'Review', description: '', dueDate: '2027-01-20', dueAt: '2027-01-20T18:30:00Z', questions: [{id: 'question', prompt: 'True?', type: 'multiple_choice', options: ['True', 'False'], correctAnswer: null, points: 1}]};
    const snapshot = {classes: [{id: 'class', name: 'Math', teacher: 'Teacher', location: '', grade: '', color: 'purple', description: ''}], assignments: [assignment], events: [], quizzes: [quiz]};
    await db.applyServerSnapshot(snapshot);
    await db.createSubmission({id: 'submission', assignmentId: 'work', kind: 'file', uri: 'data:text/plain,answer', fileName: 'answer.txt', mimeType: 'text/plain', size: 6});
    await db.submitQuizAttempt(quiz, {question: 'True'});
    const storedAttempt = sql.prepare('SELECT encrypted_answers FROM quiz_attempts').get();
    assert.equal(protection.unprotectJson(storedAttempt.encrypted_answers).question, 'True');
    await db.applyServerSnapshot(snapshot);
    const data = await db.getDashboardData();
    assert.equal(data.assignments[0].completed, true);
    assert.equal(data.assignments[0].submissionStatus, 'saved_locally');
    assert.equal(data.assignments[0].resources[0].id, 'resource');
    assert.equal(data.completedQuizIds[0], 'quiz');
    assert.equal(data.quizzes[0].dueAt, quiz.dueAt);
    assert.equal(data.events.some(event => event.id === 'quiz-event-quiz'), true);
    assert.equal((await db.getPendingChanges()).length, 2);
    await db.createQuiz({id: 'teacher-draft', classId: 'class', title: 'Draft', description: '', dueDate: '2027-01-20', dueAt: quiz.dueAt, questions: [{id: 'stable-question', type: 'short_answer', prompt: 'Explain', options: [], correctAnswer: null, points: 2}]});
    const draft = (await db.getDashboardData()).quizzes.find(q => q.id === 'teacher-draft');
    assert.equal(draft.questions[0].id, 'stable-question'); assert.equal(draft.dueAt, quiz.dueAt);
    const assistedAssignment = {...assignment, id: 'assisted-work', gradeLabel: 'A-', recipientIds: ['student']};
    await db.applyServerSnapshot({...snapshot, assignments: [assignment, assistedAssignment]});
    await db.createSubmission({id: 'assisted-submission', assignmentId: 'assisted-work', studentId: 'student', kind: 'file', uri: 'data:text/plain,work', fileName: 'work.txt', mimeType: 'text/plain', size: 4});
    await db.applyServerSnapshot({...snapshot, assignments: [assignment, assistedAssignment]});
    const staffWork = (await db.getDashboardData()).assignments.find(a => a.id === 'assisted-work');
    assert.equal(staffWork.completed, false); assert.equal(staffWork.gradeLabel, 'A-'); assert.equal(staffWork.recipientIds[0], 'student');
    assert.equal((await db.getPendingChanges()).find(change => change.payload.id === 'assisted-submission').payload.studentId, 'student');
    await db.createClass({id: 'offline-class', name: 'Offline class', teacher: 'Teacher', sectionName: null, location: '', grade: '', color: 'purple', description: ''});
    await db.queueMutation('/api/classes', 'POST', {id: 'offline-class', name: 'Offline class'});
    await db.createEvent({title: 'My reminder', date: '2027-01-20', kind: 'class', localOnly: true});
    await db.applyServerSnapshot({classes: [], assignments: [], events: [], quizzes: [], materials: []});
    const revoked = await db.getDashboardData();
    assert.equal(revoked.assignments.length, 0); assert.equal(revoked.quizzes.length, 0);
    assert.equal(revoked.classes[0].id, 'offline-class'); assert.equal(revoked.events.length, 1);
    assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM quiz_attempts').get().count, 1);
    assert.throws(() => sql.exec('DELETE FROM quiz_attempts'), /cannot be deleted/);
  } finally {sql.close();}
});

test('session and local encryption key restore without contacting the Pi', async () => {
  const values = new Map(); let restored = null;
  const db = {execAsync: async () => {}, runAsync: async (sql, ...args) => {if (sql.startsWith('DELETE')) values.delete(args[0]); else values.set(args[0], args[1]);}, getFirstAsync: async (sql, key) => values.has(key) ? {value: values.get(key)} : null};
  const storage = load('src/services/sessionStorage.ts', {'expo-sqlite': {openDatabaseAsync: async () => db}, './dataProtection': {exportProtectionKey: () => 'encoded-key', restoreProtectionKey: key => {restored = key;}}});
  await storage.saveSession({token: 'persistent-token', user: {id: 'learner', role: 'student'}}, 'http://photobooth.local:9000');
  const session = await storage.readSession();
  assert.equal(session.token, 'persistent-token'); assert.equal(restored, 'encoded-key');
  await storage.clearSession(); assert.equal(await storage.readSession(), null);
});

test('offline quizzes remain queued with the original answers', async () => {
  const pending = [{id: 'attempt-1', type: 'quiz-attempt', payload: {quizId: 'quiz-1', answers: {'question-1': 'True'}}}];
  let received;
  const {LocalSyncQueue} = load('src/services/syncQueue.ts', {'../db/database': {accountScope: () => 'user', getPendingChanges: async () => pending, removePendingChange: async () => {}, recordPendingChangeFailure: async () => {}}, 'react-native': {Platform: {OS: 'web'}}});
  await new LocalSyncQueue().flush({attemptQuiz: async (id, answers) => {received = {id, answers};}});
  assert.equal(received.id, 'quiz-1'); assert.equal(received.answers['question-1'], 'True');
});

test('native written responses upload as files without fetching a data URL', async () => {
  let written, acknowledged = false;
  const pending = [{id: 'outbox-written', type: 'submission', payload: {id: 'written', assignmentId: 'worksheet', kind: 'file', uri: 'data:text/plain;charset=utf-8,My%20answer%20%E2%9C%93', fileName: 'written-response.txt', mimeType: 'text/plain'}}];
  class NativeForm {values = new Map(); append(key, value) {this.values.set(key, value);} get(key) {return this.values.get(key);}}
  const {LocalSyncQueue} = load('src/services/syncQueue.ts', {
    '../db/database': {accountScope: () => 'student', accountStorageName: () => 'student.db', getPendingChanges: async () => pending, removePendingChange: async () => {}, recordPendingChangeFailure: async (id, reason) => {throw Error(reason);}, acknowledgeSubmission: async () => {acknowledged = true;}},
    'react-native': {Platform: {OS: 'android'}},
    'expo-file-system/legacy': {documentDirectory: 'file:///documents/', makeDirectoryAsync: async () => {}, EncodingType: {UTF8: 'utf8'}, writeAsStringAsync: async (uri, content) => {written = {uri, content};}},
  }, {FormData: NativeForm, fetch: async () => {throw Error('Native code must not fetch data URLs');}});
  const result = await new LocalSyncQueue().flush({upload: async form => {assert.equal(form.get('file').uri, written.uri); return {id: 'file'};}, submit: async () => ({id: 'written'}), attach: async () => {}});
  assert.equal(written.content, 'My answer ✓'); assert.equal(acknowledged, true); assert.equal(result.accepted[0], 'outbox-written');
});
