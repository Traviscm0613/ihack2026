const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText;
  const context = {exports: {}, require: name => {if (!(name in modules)) throw Error(`Unexpected dependency ${name}`); return modules[name];}, fetch, FormData, Blob, setTimeout, clearTimeout, console};
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
