import { clearPendingChanges, enqueuePendingChange, getPendingChangeCount } from '../db/database';

export type SyncState = 'synced' | 'pending' | 'offline';

export type PendingChange = {
  id: string;
  type: 'assignment-completion' | 'submission';
  createdAt: string;
  payload: Record<string, string | number | boolean>;
};

// Replace this adapter with AsyncStorage/SQLite when persistence is added.
export class LocalSyncQueue {
  enqueue(change: PendingChange) { return enqueuePendingChange(change); }
  pendingCount() { return getPendingChangeCount(); }
  clear() { return clearPendingChanges(); }
  async state(): Promise<SyncState> { return (await this.pendingCount()) ? 'pending' : 'synced'; }
}

export const syncQueue = new LocalSyncQueue();
