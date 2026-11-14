import { clearPendingChanges, enqueuePendingChange, getPendingChangeCount, getPendingChanges, recordPendingChangeFailure, removePendingChange, acknowledgeSubmission } from '../db/database';
import type { LocalServerClient } from './serverApi';
import {Platform} from 'react-native';
import {accountScope, accountStorageName} from '../db/database';

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
  private flushing: Promise<SyncResult> | null = null;
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

  flush(client: LocalServerClient): Promise<SyncResult> {
    if (!this.flushing) this.flushing = this.flushPending(client).finally(() => {this.flushing = null;});
    return this.flushing;
  }
  private async flushPending(client: LocalServerClient): Promise<SyncResult> {
    const scope = accountScope();
    const pending = await getPendingChanges();
    if (!pending.length) return { accepted: [], failed: [] };
    const failed: SyncResult['failed'] = [];
    let accepted: string[] = [];
    try {
      for (const item of pending) {
        if (scope !== accountScope()) return {accepted: [], failed: []};
        try {
          const p = item.payload;
          if (item.type === 'mutation') {
            const body = {...p.body as Record<string, unknown>};
            const files = (body.__files ?? []) as {id: string; uri: string; name: string; type: string}[];
            delete body.__files;
            await client.replay(String(p.path), body, String(p.method));
            for (const attachment of files) {
              const form = new FormData();
              form.append('uploadId', attachment.id);
              if (Platform.OS === 'web') form.append('file', await (await fetch(attachment.uri)).blob(), attachment.name);
              else form.append('file', {uri: attachment.uri, name: attachment.name, type: attachment.type} as unknown as Blob);
              const file = await client.upload(form);
              await client.replay(`/api/assignments/${body.id}/resources`, {...file, resourceId: attachment.id});
            }
            accepted.push(item.id); continue;
          }
          if (item.type === 'quiz-attempt') {await client.attemptQuiz(String(p.quizId), p.answers as Record<string, string>); accepted.push(item.id); continue;}
          if (item.type !== 'submission') throw new Error('Unsupported operation; retained for review.');
          const form = new FormData();
          form.append('uploadId', item.id);
          if (Platform.OS === 'web') {
            const response = await fetch(String(p.content ?? p.uri));
            form.append('file', await response.blob(), String(p.fileName ?? 'submission.bin'));
          } else {
            let uri = String(p.uri);
            if (uri.startsWith('data:')) {
              // Native HTTP clients cannot fetch data URLs. Stage written responses
              // as files, including responses queued by earlier app versions.
              const fs = await import('expo-file-system/legacy');
              const directory = `${fs.documentDirectory}submissions/${accountStorageName()}/`;
              await fs.makeDirectoryAsync(directory, {intermediates: true});
              const comma = uri.indexOf(',');
              const base64 = uri.slice(0, comma).endsWith(';base64');
              const content = base64 ? uri.slice(comma + 1) : decodeURIComponent(uri.slice(comma + 1));
              uri = `${directory}${item.id.replace(/[^a-zA-Z0-9._-]/g, '_')}.txt`;
              await fs.writeAsStringAsync(uri, content, {encoding: base64 ? fs.EncodingType.Base64 : fs.EncodingType.UTF8});
            }
            form.append('file', {uri, name: p.fileName ?? 'submission.bin', type: p.mimeType ?? 'application/octet-stream'} as unknown as Blob);
          }
          const file = await client.upload(form);
          const submission = await client.submit({id: p.id, assignmentId: p.assignmentId, studentId: p.studentId, kind: p.kind});
          await client.attach(submission.id, file);
          if(scope !== accountScope()) return {accepted: [], failed: []};
          await acknowledgeSubmission(String(p.id));
          accepted.push(item.id);
        } catch(error) {
          if(scope !== accountScope()) return {accepted: [], failed: []};
          const reason = String(error); failed.push({id: item.id, reason}); await recordPendingChangeFailure(item.id, reason);
        }
      }
      if(scope !== accountScope()) return {accepted: [], failed: []};
      for (const id of accepted) {
        if (scope !== accountScope()) return {accepted: [], failed: []};
        await removePendingChange(id);
      }
    } catch (error) {
      if (scope !== accountScope()) return {accepted: [], failed: []};
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
