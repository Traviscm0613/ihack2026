import {createThemedStyles} from '../theme';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { faArrowLeft, faArrowRight, faCamera, faFileArrowUp, faImage } from '@fortawesome/free-solid-svg-icons';
import { useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Assignment, SubmissionType } from '../data/mockData';
import { createSubmission } from '../db/database';
import { AppIcon } from '../components/AppIcon';
import { theme } from '../theme';
import {LocalServerClient} from '../services/serverApi';
import {syncQueue} from '../services/syncQueue';
import {FileAttachments} from '../components/FileAttachments';
import {cacheValue, cachedValue, accountStorageName} from '../db/database';
import {useEffect} from 'react';

const labels: Record<SubmissionType, string> = { file: 'Upload a file', photo: 'Choose a picture', scan: 'Scan with camera' };
const icons = { file: faFileArrowUp, photo: faImage, scan: faCamera };

export function SubmissionScreen({ assignment, onBack, onSubmitted }: { assignment: Assignment; onBack: () => void; onSubmitted: () => Promise<void> }) {
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [written, setWritten] = useState('');
  useEffect(() => {cachedValue<string>(`written:${assignment.id}`).then(value => {if(value) setWritten(value);});}, [assignment.id]);
  const [staged, setStaged] = useState<{ kind: SubmissionType; uri: string; fileName: string; mimeType: string; size: number | null; content: string | null } | null>(null);
  const [stageReady, setStageReady] = useState(false);
  useEffect(() => {cachedValue<NonNullable<typeof staged>>(`staged:${assignment.id}`).then(value => {setStaged(value); setStageReady(true);});}, [assignment.id]);
  useEffect(() => {if(stageReady) void cacheValue(`staged:${assignment.id}`, staged);}, [staged, stageReady, assignment.id]);

  const chooseSubmission = async (kind: SubmissionType) => {
    try {
      setMessage('');
      let uri: string;
      let fileName: string;
      let mimeType: string;
      let size: number | null;
      let base64: string | null = null;
      if (kind === 'file') {
        const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, base64: Platform.OS === 'web' });
        if (result.canceled) return;
        const asset = result.assets[0];
        uri = asset.uri;
        fileName = asset.name;
        mimeType = asset.mimeType ?? 'application/octet-stream';
        size = asset.size ?? null;
        base64 = asset.base64 ?? null;
      } else {
        if (kind === 'scan' && Platform.OS !== 'web' && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
          throw Error('Allow camera access to scan your work, or choose a saved picture instead.');
        }
        const result = kind === 'scan' ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85, base64: Platform.OS === 'web' }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85, base64: Platform.OS === 'web' });
        if (result.canceled) return;
        const asset = result.assets[0];
        uri = asset.uri;
        fileName = asset.fileName ?? `${assignment.id}-${kind}.jpg`;
        mimeType = asset.mimeType ?? 'image/jpeg';
        size = asset.fileSize ?? null;
        base64 = asset.base64 ?? null;
      }
      setSaving(true);
      let localUri = uri;
      let content: string | null = null;
      if (Platform.OS === 'web') {
        content = base64 ? `data:${mimeType};base64,${base64}` : null;
        localUri = content ?? uri;
      } else {
        const directory = `${FileSystem.documentDirectory}submissions/${accountStorageName()}/`;
        await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
        localUri = `${directory}${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        await FileSystem.copyAsync({ from: uri, to: localUri });
      }
      setStaged({ kind, uri: localUri, fileName, mimeType, size, content });
      setMessage('File ready. Press Submit assignment to confirm.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save this submission.');
    } finally {
      setSaving(false);
    }
  };

  const confirmSubmission = async () => {
    if (!staged) return;
    try {
      setSaving(true);
      const client = new LocalServerClient();
      await createSubmission({ assignmentId: assignment.id, ...staged });
      setStaged(null);
      setMessage('Saved on this device. It will be sent automatically when the Pi is reachable.');
      void syncQueue.flush(client).then(async result => {
        setMessage(result.failed.length ? 'Saved on this device. Reconnect to send it to your teacher.' : 'Received by your teacher.');
        await onSubmitted();
      }).catch(error => setMessage(String(error)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not submit this work.');
    } finally {
      setSaving(false);
    }
  };

  return <View>
    <Pressable onPress={onBack} style={styles.back}><AppIcon icon={faArrowLeft} size={12} color={theme.colors.violet} /><Text style={styles.backText}>Back to assignments</Text></Pressable>
    <Text style={styles.eyebrow}>SUBMIT WORK</Text>
    <Text style={styles.title}>{assignment.title}</Text>
    <Text style={styles.className}>{assignment.subject} · {assignment.teacher}</Text>
    {assignment.submissionStatus ? <Text style={styles.message}>{assignment.submissionStatus.replace(/_/g, ' ')}{assignment.submittedAt ? ` · Received ${new Date(assignment.submittedAt).toLocaleString()}` : ''}</Text> : null}
    {assignment.grade !== null || assignment.gradeLabel || assignment.feedback ? <View style={styles.card}><Text style={styles.sectionTitle}>Teacher feedback</Text><Text style={styles.value}>{assignment.grade !== null ? `Grade: ${assignment.grade}` : assignment.gradeLabel ? `Grade: ${assignment.gradeLabel}` : 'Not graded yet'}</Text><Text style={styles.description}>{assignment.feedback || 'No written feedback yet.'}</Text></View> : null}
    <View style={styles.card}><Text style={styles.label}>Due date</Text><Text style={styles.value}>{assignment.dueAt ? new Date(assignment.dueAt).toLocaleString() : assignment.dueDate}</Text><Text style={styles.label}>Instructions</Text><Text style={styles.description}>{assignment.description || 'No additional instructions.'}</Text></View>
    {assignment.resources?.length ? <View style={styles.card}><Text style={styles.sectionTitle}>Assignment documents</Text><FileAttachments files={assignment.resources}/></View> : null}
    <Text style={styles.sectionTitle}>Choose a submission</Text>
    {assignment.submissionTypes.includes('file') ? <View style={styles.card}><Text style={styles.label}>Write your response</Text><TextInput multiline value={written} onChangeText={value => {setWritten(value); void cacheValue(`written:${assignment.id}`, value);}} placeholder="Write here. Your draft saves on this device." placeholderTextColor={theme.colors.muted} style={[styles.description, {minHeight: 120, padding: 12, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 10}]}/><Pressable disabled={!written.trim() || saving} onPress={async () => {
      const uri = `data:text/plain;charset=utf-8,${encodeURIComponent(written)}`;
      setStaged({kind: 'file', uri, fileName: 'written-response.txt', mimeType: 'text/plain', size: new TextEncoder().encode(written).length, content: uri});
      setMessage('Response ready. Confirm submission below.');
    }}><Text style={styles.backText}>Use this written response</Text></Pressable></View> : null}
    {assignment.submissionTypes.map((type) => <Pressable key={type} disabled={saving} onPress={() => chooseSubmission(type)} style={styles.option}><AppIcon icon={icons[type]} size={17} color={theme.colors.violet} /><View style={styles.optionCopy}><Text style={styles.optionTitle}>{labels[type]}</Text><Text style={styles.optionBody}>{type === 'file' ? 'Select a PDF, DOCX, or other document.' : type === 'photo' ? 'Use a saved picture of your work.' : 'Take a photo of handwritten work.'}</Text></View><AppIcon icon={faArrowRight} size={13} color={theme.colors.violet} /></Pressable>)}
    {staged ? <View style={styles.staged}><View style={styles.stagedIcon}><AppIcon icon={icons[staged.kind]} size={15} color={theme.colors.violet} /></View><View style={styles.stagedCopy}><Text style={styles.stagedTitle}>Ready to submit</Text><Text numberOfLines={1} style={styles.stagedFile}>{staged.fileName}</Text></View><Pressable onPress={() => setStaged(null)}><Text style={styles.remove}>Remove</Text></Pressable></View> : null}
    {staged ? <Pressable disabled={saving} onPress={confirmSubmission} style={styles.submitButton}><Text style={styles.submitButtonText}>{saving ? 'Submitting…' : 'Submit assignment'}</Text></Pressable> : null}
    {message ? <Text style={styles.message}>{message}</Text> : null}
  </View>;
}

const styles = createThemedStyles({ back: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 22 }, backText: { color: theme.colors.violet, fontSize: 12, fontWeight: '800' }, eyebrow: { color: theme.colors.violet, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 }, title: { color: theme.colors.ink, fontSize: 26, fontWeight: '800', marginTop: 8 }, className: { color: theme.colors.muted, fontSize: 11, marginTop: 5 }, card: { backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 13, padding: 17, marginTop: 18, marginBottom: 20 }, label: { color: '#a0a9bb', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginTop: 3 }, value: { color: theme.colors.ink, fontSize: 13, fontWeight: '800', marginTop: 5, marginBottom: 16 }, description: { color: theme.colors.muted, fontSize: 12, lineHeight: 19, marginTop: 5 }, sectionTitle: { color: theme.colors.ink, fontSize: 16, fontWeight: '800', marginBottom: 10 }, option: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 11, padding: 15, marginBottom: 9 }, optionCopy: { flex: 1 }, optionTitle: { color: theme.colors.ink, fontSize: 13, fontWeight: '800' }, optionBody: { color: theme.colors.muted, fontSize: 10, marginTop: 5, paddingRight: 20 }, staged: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.colors.violetSoft, borderRadius: 10, padding: 12, marginTop: 5 }, stagedIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.white, borderRadius: 8 }, stagedCopy: { flex: 1 }, stagedTitle: { color: theme.colors.violet, fontSize: 11, fontWeight: '800' }, stagedFile: { color: theme.colors.muted, fontSize: 10, marginTop: 3 }, remove: { color: '#bd6870', fontSize: 10, fontWeight: '800' }, submitButton: { alignItems: 'center', backgroundColor: theme.colors.green, borderRadius: 9, paddingVertical: 13, marginTop: 11 }, submitButtonText: { color: theme.colors.white, fontSize: 12, fontWeight: '800' }, message: { color: theme.colors.green, fontSize: 12, fontWeight: '800', marginTop: 10 } });
