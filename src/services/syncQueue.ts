export type SyncState = 'synced' | 'pending' | 'offline';

export type PendingChange = {
  id: string;
  type: 'assignment-progress' | 'submission';
  createdAt: string;
  payload: Record<string, string | number>;
};

// Replace this adapter with AsyncStorage/SQLite when persistence is added.
export class LocalSyncQueue {
  private queue: PendingChange[] = [];

  enqueue(change: PendingChange) { this.queue.push(change); }
  get pendingCount() { return this.queue.length; }
  clear() { this.queue = []; }
  get state(): SyncState { return this.queue.length ? 'pending' : 'synced'; }
}

export const syncQueue = new LocalSyncQueue();
