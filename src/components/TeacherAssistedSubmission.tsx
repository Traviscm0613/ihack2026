import {useEffect, useState} from 'react';
import {Platform} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import type {Assignment, SubmissionType} from '../data/mockData';
import {accountStorageName, cacheValue, cachedValue, createSubmission} from '../db/database';
import {Caption, Heading, Panel, Pressable, Text} from './WorkspaceUI';

type Draft = {assignmentId: string; studentId: string; file: {kind: SubmissionType; uri: string; fileName: string; mimeType: string; size: number | null} | null};
export function TeacherAssistedSubmission({classId, assignments, students, onSaved, onMessage}: {classId: string; assignments: Assignment[]; students: {id: string; displayName: string}[]; onSaved: () => Promise<void>; onMessage: (message: string) => void}) {
  const [draft, setDraft] = useState<Draft>({assignmentId: '', studentId: '', file: null});
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = `assisted:${classId}`;
  useEffect(() => {let active = true; cachedValue<Draft>(key).then(saved => {if (active) {if (saved) setDraft(saved); setReady(true);}}).catch(error => onMessage(String(error))); return () => {active = false;};}, [key]);
  useEffect(() => {if (ready) void cacheValue(key, draft).catch(error => onMessage(String(error)));}, [ready, draft, key]);
  const assignment = assignments.find(item => item.id === draft.assignmentId);
  const eligible = students.filter(student => !assignment?.recipientIds?.length || assignment.recipientIds.includes(student.id));
  const pick = async () => {
    if (!assignment) return;
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({copyToCacheDirectory: true, type: assignment.submissionTypes.includes('file') ? '*/*' : 'image/*'});
      if (result.canceled) return;
      const asset = result.assets[0];
      let uri = asset.uri;
      if (Platform.OS === 'web') {
        const blob = await (await fetch(uri)).blob();
        uri = await new Promise<string>((resolve, reject) => {const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);});
      } else {
        const directory = `${FileSystem.documentDirectory}submissions/${accountStorageName()}/`;
        await FileSystem.makeDirectoryAsync(directory, {intermediates: true});
        uri = `${directory}assisted-${Date.now()}-${asset.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        await FileSystem.copyAsync({from: asset.uri, to: uri});
      }
      const kind = assignment.submissionTypes.includes('file') ? 'file' : assignment.submissionTypes[0];
      setDraft(current => ({...current, file: {kind, uri, fileName: asset.name, mimeType: asset.mimeType ?? 'application/octet-stream', size: asset.size ?? null}}));
    } catch(error) {onMessage(String(error));} finally {setBusy(false);}
  };
  return <Panel><Heading>Submit on a student's behalf</Heading><Caption>Choose the student's assignment, attach their document or a photo of their work, then confirm. Files save on this device until the Pi receives them.</Caption>
    <Text>Assignment</Text>{assignments.filter(item => item.classId === classId).map(item => <Pressable key={item.id} disabled={!ready || busy} onPress={() => setDraft(current => ({...current, assignmentId: item.id, studentId: '', file: null}))}><Text>{draft.assignmentId === item.id ? '✓ ' : ''}{item.title}</Text></Pressable>)}
    {assignment ? <><Text>Student</Text>{eligible.map(student => <Pressable key={student.id} disabled={!ready || busy} onPress={() => setDraft(current => ({...current, studentId: student.id}))}><Text>{draft.studentId === student.id ? '✓ ' : ''}{student.displayName}</Text></Pressable>)}<Pressable disabled={!ready || busy} onPress={pick}><Text>Choose student's document or photo</Text></Pressable></> : null}
    {draft.file ? <Text>{draft.file.fileName}</Text> : null}<Pressable disabled={!ready || busy || !assignment || !draft.file || !eligible.some(student => student.id === draft.studentId)} onPress={async () => {
      if (!draft.file) return;
      setBusy(true);
      try {
        await createSubmission({...draft.file, assignmentId: draft.assignmentId, studentId: draft.studentId});
        setDraft(current => ({...current, file: null}));
        onMessage('Student work saved on this device and queued for delivery.');
        void onSaved();
      } catch(error) {onMessage(String(error));} finally {setBusy(false);}
    }}><Text>{busy ? 'Saving…' : 'Confirm student submission'}</Text></Pressable>
  </Panel>;
}
