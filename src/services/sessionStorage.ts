import {openDatabaseAsync} from 'expo-sqlite';
import type {Session} from './serverApi';
import {exportProtectionKey, restoreProtectionKey} from './dataProtection';

export type SavedSession = Session & {serverUrl: string; protectionKey: string};
// The web implementation of expo-sqlite uses an exclusive OPFS access handle
// for each database file. Re-opening this file for every operation can leave
// two handles alive during React development remounts and causes
// createSyncAccessHandle/"Invalid VFS state" failures.
let deviceDatabase: Awaited<ReturnType<typeof openDatabaseAsync>> | null = null;
let deviceDatabasePromise: ReturnType<typeof openDatabaseAsync> | null = null;
const database = async () => {
  if (deviceDatabase) return deviceDatabase;
  if (!deviceDatabasePromise) {
    deviceDatabasePromise = openDatabaseAsync('locallearn-device.db').then(async db => {
      await db.execAsync('CREATE TABLE IF NOT EXISTS device_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      deviceDatabase = db;
      return db;
    });
  }
  return deviceDatabasePromise;
};
export async function saveSession(session: Session, serverUrl: string) {
  const value: SavedSession = {...session, serverUrl, protectionKey: exportProtectionKey()};
  await (await database()).runAsync('INSERT OR REPLACE INTO device_settings VALUES (?, ?)', 'session', JSON.stringify(value));
}
export async function readSession(): Promise<SavedSession | null> {
  const row = await (await database()).getFirstAsync<{value: string}>('SELECT value FROM device_settings WHERE key=?', 'session');
  if (!row) return null;
  const saved = JSON.parse(row.value) as SavedSession;
  restoreProtectionKey(saved.protectionKey);
  return saved;
}
export async function clearSession() {
  await (await database()).runAsync('DELETE FROM device_settings WHERE key=?', 'session');
}
