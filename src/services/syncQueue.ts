import { clearPendingChanges, enqueuePendingChange, getPendingChangeCount, getPendingChanges, recordPendingChangeFailure, removePendingChange } from '../db/database';
import type { LocalServerClient } from './serverApi';

export type SyncState = 'synced' | 'pending' | 'offline';

export type PendingChange = {
  id: string;
  type: 'assignment-completion' | 'submission';
  createdAt: string;
  payload: Record<string, string | number | boolean>;
};

export type SyncResult = {
  accepted: string[];
  failed: { id: string; reason: string }[];
};

export class LocalSyncQueue {
  enqueue(change: PendingChange) {
    return enqueuePendingChange(change);
  }

  pendingCount() {
    return getPendingChangeCount();
  }

  clear() {
    return clearPendingChanges();
  }

  async state(): Promise<SyncState> {
    return (await this.pendingCount()) ? 'pending' : 'synced';
  }

  async flush(client: LocalServerClient): Promise<SyncResult> {
    const pending = await getPendingChanges();
    if (!pending.length) return { accepted: [], failed: [] };
    const failed: SyncResult['failed'] = [];
    let accepted: string[] = [];
    try {
      const result = await client.sync(pending.map(({ id, type, payload, createdAt }) => ({ id, type, payload, createdAt })));
      accepted = result.accepted;
      for (const id of accepted) await removePendingChange(id);
      for (const rejection of result.rejected ?? []) {
        failed.push(rejection);
        await recordPendingChangeFailure(rejection.id, rejection.reason);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Sync failed.';
      for (const item of pending) {
        failed.push({ id: item.id, reason });
        await recordPendingChangeFailure(item.id, reason);
      }
    }
    return { accepted, failed };
  }
}

export const syncQueue = new LocalSyncQueue();
