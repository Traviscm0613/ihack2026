import { clearPendingChanges, enqueuePendingChange, getPendingChangeCount, getPendingChanges, recordPendingChangeFailure, removePendingChange } from '../db/database';
import type { LocalServerClient } from './serverApi';
import {Platform} from 'react-native';

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
      for (const item of pending) {
        try {
          if (item.type !== 'submission') throw new Error('Unsupported operation; retained for review.');
          const p = item.payload;
          const form = new FormData();
          if (Platform.OS === 'web') {
            const response = await fetch(String(p.content ?? p.uri));
            form.append('file', await response.blob(), String(p.fileName ?? 'submission.bin'));
          } else form.append('file', {uri: p.uri, name: p.fileName ?? 'submission.bin', type: p.mimeType ?? 'application/octet-stream'} as unknown as Blob);
          const file = await client.upload(form);
          const submission = await client.submit({id: p.id, assignmentId: p.assignmentId});
          await client.attach(submission.id, file);
          accepted.push(item.id);
        } catch(error) {
          const reason = String(error); failed.push({id: item.id, reason}); await recordPendingChangeFailure(item.id, reason);
        }
      }
      for (const id of accepted) await removePendingChange(id);
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
