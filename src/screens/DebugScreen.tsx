import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { createAssignment, createClass, createEvent, createQuiz, type QuizQuestionType, type SchoolClass } from '../db/database';
import { type SubmissionType } from '../data/mockData';
import { getConfiguredServerUrl, getConfiguredServerUrls } from '../services/serverApi';
import { theme } from '../theme';

export function DebugScreen({ classes, onSaved }: { classes: SchoolClass[]; onSaved: () => Promise<void> }) {
  const [assignmentTitle, setAssignmentTitle] = useState('');
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [dueDate, setDueDate] = useState('2026-11-25');
  const [description, setDescription] = useState('');
  const [submissionTypes, setSubmissionTypes] = useState<SubmissionType[]>(['file']);
  const [eventTitle, setEventTitle] = useState('');
  const [date, setDate] = useState('2026-11-21');
  const [message, setMessage] = useState('');
  const [className, setClassName] = useState('');
  const [classSection, setClassSection] = useState('');
  const [classTeacher, setClassTeacher] = useState('');
  const [classLocation, setClassLocation] = useState('');
  const [classDescription, setClassDescription] = useState('');
  const [quizTitle, setQuizTitle] = useState('');
  const [quizDescription, setQuizDescription] = useState('');
  const [quizQuestion, setQuizQuestion] = useState('');
  const [quizType, setQuizType] = useState<QuizQuestionType>('multiple_choice');
  const [quizOptions, setQuizOptions] = useState('');
  const [quizAnswer, setQuizAnswer] = useState('');
  const [classColor, setClassColor] = useState<SchoolClass['color']>('purple');
  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [sendingFile, setSendingFile] = useState(false);
  const [fileMessage, setFileMessage] = useState('');

  const chooseFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (!result.canceled) {
      setSelectedFile(result.assets[0]);
      setFileMessage('File selected and ready to send.');
    }
  };

  const sendFileToRaspberryPi = async () => {
    if (!selectedFile) return setFileMessage('Choose a file first.');
    setSendingFile(true);
    setFileMessage('Sending file to Raspberry Pi…');
    try {
      let lastError = 'No HTTP response was received.';
      for (const candidate of getConfiguredServerUrls()) {
        const url = `${/^https?:\/\//i.test(candidate) ? candidate : `http://${candidate}`}`.replace(/\/$/, '');
        try {
          const form = new FormData();
          const mimeType = selectedFile.mimeType ?? 'application/octet-stream';
          if (Platform.OS === 'web') {
            const fileResponse = await fetch(selectedFile.uri);
            if (!fileResponse.ok) throw new Error(`Unable to read the selected file (${fileResponse.status}).`);
            const blob = await fileResponse.blob();
            form.append('file', blob, selectedFile.name);
          } else {
            form.append('file', { uri: selectedFile.uri, name: selectedFile.name, type: mimeType } as unknown as Blob);
          }
          const response = await fetch(`${url}/api/files/upload`, { method: 'POST', headers: { Accept: 'application/json' }, body: form });
          const responseBody = await response.text();
          if (!response.ok) throw new Error(`The Pi returned ${response.status}${responseBody ? `: ${responseBody.slice(0, 180)}` : '.'}`);
          setFileMessage(`${selectedFile.name} sent successfully through ${url}. Pi response: ${responseBody || `HTTP ${response.status}`}`);
          return;
        } catch (error) {
          lastError = error instanceof Error ? error.message : 'No HTTP response was received.';
        }
      }
      throw new Error(`${lastError} Tried the Photobooth hostnames and hotspot address. If this is Expo web, the Pi API must also allow CORS from the app’s origin.`);
    } catch (error) {
      setFileMessage(error instanceof Error ? `Unable to send file: ${error.message}` : 'Unable to send file to the Raspberry Pi.');
    } finally { setSendingFile(false); }
  };

  const addAssignment = async () => {
    if (!assignmentTitle.trim()) return setMessage('Enter an assignment title first.');
    const selectedClass = classes.find((item) => item.id === classId) ?? classes[0];
    await createAssignment({ title: assignmentTitle.trim(), subject: selectedClass?.name ?? 'Test subject', teacher: selectedClass?.teacher ?? 'Developer tool', dueDate, completed: false, tone: 'math', classId: selectedClass?.id ?? '', description, submissionTypes, grade: null, feedback: null });
    setAssignmentTitle('');
    setDescription('');
    setMessage('Assignment added to SQLite.');
    await onSaved();
  };

  const addEvent = async () => {
    if (!eventTitle.trim()) return setMessage('Enter an event title first.');
    await createEvent({ title: eventTitle.trim(), date, kind: 'school', localOnly: true });
    setEventTitle('');
    setMessage('Event added to SQLite.');
    await onSaved();
  };

  const addClass = async () => {
    if (!className.trim()) return setMessage('Enter a class name first.');
    const id = await createClass({ name: className.trim(), sectionName: classSection.trim() || null, teacher: classTeacher.trim() || 'Teacher', location: classLocation.trim() || 'Room TBD', grade: '—', color: classColor, description: classDescription.trim() || `${className.trim()} course materials and class information.` });
    setClassName('');
    setClassSection('');
    setClassTeacher('');
    setClassLocation('');
    setClassDescription('');
    setClassId(id);
    setMessage('Class added to SQLite.');
    await onSaved();
  };

  const addQuiz = async () => {
    const selectedClass = classes.find((item) => item.id === classId) ?? classes[0];
    if (!quizTitle.trim() || !quizQuestion.trim() || !selectedClass) return setMessage('Add a quiz title, question, and class first.');
    await createQuiz({ title: quizTitle.trim(), description: quizDescription.trim(), classId: selectedClass.id, dueDate, questions: [{ prompt: quizQuestion.trim(), type: quizType, options: quizType === 'multiple_choice' ? quizOptions.split(',').map((option) => option.trim()).filter(Boolean) : [], correctAnswer: quizType === 'multiple_choice' ? quizAnswer.trim() || null : null, points: 1 }] });
    setQuizTitle('');
    setQuizDescription('');
    setQuizQuestion('');
    setQuizOptions('');
    setQuizAnswer('');
    setMessage('Quiz added to SQLite.');
    await onSaved();
  };

  return <View style={styles.container}>
    <Text style={styles.eyebrow}>DEVELOPER TOOLS</Text>
    <Text style={styles.title}>Local database test data</Text>
    <Text style={styles.body}>Use this screen while the Raspberry Pi API is being built. Records are written directly to the device SQLite database.</Text>
    <View style={styles.card}><Text style={styles.cardTitle}>Send file to Raspberry Pi</Text><Text style={styles.exchangeBody}>Choose a file and send it over the Pi’s Wi‑Fi connection. Connected to {getConfiguredServerUrl()}.</Text><Pressable style={styles.secondaryButton} onPress={chooseFile}><Text style={styles.secondaryButtonText}>{selectedFile ? 'Choose a different file' : 'Choose file'}</Text></Pressable>{selectedFile ? <Text numberOfLines={1} style={styles.selectedFile}>{selectedFile.name}</Text> : null}<Pressable disabled={sendingFile} style={[styles.button, sendingFile && styles.disabledButton]} onPress={sendFileToRaspberryPi}><Text style={styles.buttonText}>{sendingFile ? 'Sending…' : 'Send file to Pi'}</Text></Pressable>{fileMessage ? <Text style={styles.exchangeMessage}>{fileMessage}</Text> : null}</View>
    <View style={styles.card}><Text style={styles.cardTitle}>Add class</Text><TextInput value={className} onChangeText={setClassName} placeholder="Class name" placeholderTextColor="#a0a9bb" style={styles.input} /><TextInput value={classSection} onChangeText={setClassSection} placeholder="Section name (optional)" placeholderTextColor="#a0a9bb" style={styles.input} /><TextInput value={classTeacher} onChangeText={setClassTeacher} placeholder="Teacher" placeholderTextColor="#a0a9bb" style={styles.input} /><TextInput value={classLocation} onChangeText={setClassLocation} placeholder="Room or location" placeholderTextColor="#a0a9bb" style={styles.input} /><TextInput value={classDescription} onChangeText={setClassDescription} placeholder="Class description" placeholderTextColor="#a0a9bb" multiline style={[styles.input, styles.multiline]} /><Text style={styles.label}>Color</Text><View style={styles.chips}>{(['purple', 'blue', 'green', 'orange'] as const).map((color) => <Pressable key={color} onPress={() => setClassColor(color)} style={[styles.chip, classColor === color && styles.selectedChip]}><Text style={[styles.chipText, classColor === color && styles.selectedChipText]}>{color}</Text></Pressable>)}</View><Pressable style={styles.button} onPress={addClass}><Text style={styles.buttonText}>Save class</Text></Pressable></View>
    <View style={styles.card}><Text style={styles.cardTitle}>Add assignment</Text><TextInput value={assignmentTitle} onChangeText={setAssignmentTitle} placeholder="Assignment title" placeholderTextColor="#a0a9bb" style={styles.input} /><TextInput value={description} onChangeText={setDescription} placeholder="Description or instructions" placeholderTextColor="#a0a9bb" multiline style={[styles.input, styles.multiline]} /><Text style={styles.label}>Class</Text><View style={styles.chips}>{classes.map((item) => <Pressable key={item.id} onPress={() => setClassId(item.id)} style={[styles.chip, classId === item.id && styles.selectedChip]}><Text style={[styles.chipText, classId === item.id && styles.selectedChipText]}>{item.name}</Text></Pressable>)}</View><Text style={styles.label}>Due date</Text><TextInput value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" placeholderTextColor="#a0a9bb" style={styles.input} /><Text style={styles.label}>Allowed submissions</Text><View style={styles.chips}>{(['file', 'photo', 'scan'] as SubmissionType[]).map((item) => <Pressable key={item} onPress={() => setSubmissionTypes((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item])} style={[styles.chip, submissionTypes.includes(item) && styles.selectedChip]}><Text style={[styles.chipText, submissionTypes.includes(item) && styles.selectedChipText]}>{item === 'file' ? 'File upload' : item === 'photo' ? 'Picture' : 'Document scan'}</Text></Pressable>)}</View><Pressable style={styles.button} onPress={addAssignment}><Text style={styles.buttonText}>Save assignment</Text></Pressable></View>
    <View style={styles.card}><Text style={styles.cardTitle}>Add quiz</Text><TextInput value={quizTitle} onChangeText={setQuizTitle} placeholder="Quiz title" placeholderTextColor="#a0a9bb" style={styles.input} /><TextInput value={quizDescription} onChangeText={setQuizDescription} placeholder="Quiz description" placeholderTextColor="#a0a9bb" style={styles.input} /><Text style={styles.label}>Class</Text><View style={styles.chips}>{classes.map((item) => <Pressable key={item.id} onPress={() => setClassId(item.id)} style={[styles.chip, classId === item.id && styles.selectedChip]}><Text style={[styles.chipText, classId === item.id && styles.selectedChipText]}>{item.name}</Text></Pressable>)}</View><TextInput value={quizQuestion} onChangeText={setQuizQuestion} placeholder="Question prompt" placeholderTextColor="#a0a9bb" multiline style={[styles.input, styles.multiline]} /><Text style={styles.label}>Question type</Text><View style={styles.chips}>{(['multiple_choice', 'short_answer'] as const).map((type) => <Pressable key={type} onPress={() => setQuizType(type)} style={[styles.chip, quizType === type && styles.selectedChip]}><Text style={[styles.chipText, quizType === type && styles.selectedChipText]}>{type === 'multiple_choice' ? 'Multiple choice' : 'Short answer'}</Text></Pressable>)}</View>{quizType === 'multiple_choice' ? <><TextInput value={quizOptions} onChangeText={setQuizOptions} placeholder="Options, separated by commas" placeholderTextColor="#a0a9bb" style={styles.input} /><TextInput value={quizAnswer} onChangeText={setQuizAnswer} placeholder="Correct answer" placeholderTextColor="#a0a9bb" style={styles.input} /></> : <Text style={styles.note}>Short-answer questions are saved as ungraded for teacher review.</Text>}<Pressable style={styles.button} onPress={addQuiz}><Text style={styles.buttonText}>Save quiz</Text></Pressable></View>
    <View style={styles.card}><Text style={styles.cardTitle}>Add calendar event</Text><TextInput value={eventTitle} onChangeText={setEventTitle} placeholder="Event title" placeholderTextColor="#a0a9bb" style={styles.input} /><TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor="#a0a9bb" style={styles.input} /><Pressable style={styles.button} onPress={addEvent}><Text style={styles.buttonText}>Save event</Text></Pressable></View>
    {message ? <Text style={styles.message}>{message}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({ container: { paddingTop: 8 }, eyebrow: { color: theme.colors.violet, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 }, title: { color: theme.colors.ink, fontSize: 26, fontWeight: '800', marginTop: 8 }, body: { color: theme.colors.muted, fontSize: 13, lineHeight: 20, marginTop: 8, marginBottom: 18 }, card: { backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 13, padding: 17, marginBottom: 14 }, cardTitle: { color: theme.colors.ink, fontSize: 15, fontWeight: '800', marginBottom: 12 }, exchangeBody: { color: theme.colors.muted, fontSize: 11, lineHeight: 17, marginBottom: 13 }, label: { color: theme.colors.muted, fontSize: 10, fontWeight: '800', marginBottom: 7 }, input: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: 8, color: theme.colors.ink, fontSize: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 }, multiline: { minHeight: 72, textAlignVertical: 'top' }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 13 }, chip: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 7 }, selectedChip: { backgroundColor: theme.colors.violetSoft, borderColor: theme.colors.violet }, chipText: { color: theme.colors.muted, fontSize: 10, fontWeight: '700' }, selectedChipText: { color: theme.colors.violet }, note: { color: theme.colors.muted, fontSize: 10, lineHeight: 16, marginBottom: 12 }, button: { alignItems: 'center', backgroundColor: theme.colors.violet, borderRadius: 8, paddingVertical: 11, marginTop: 10 }, secondaryButton: { alignItems: 'center', borderWidth: 1, borderColor: theme.colors.violet, borderRadius: 8, paddingVertical: 11, marginBottom: 10 }, secondaryButtonText: { color: theme.colors.violet, fontSize: 11, fontWeight: '800' }, selectedFile: { color: theme.colors.ink, fontSize: 10, marginBottom: 2 }, disabledButton: { opacity: 0.6 }, buttonText: { color: theme.colors.white, fontSize: 11, fontWeight: '800' }, exchangeMessage: { color: theme.colors.green, fontSize: 10, lineHeight: 15, marginTop: 11 }, message: { color: theme.colors.green, fontSize: 12, fontWeight: '700', textAlign: 'center' } });
