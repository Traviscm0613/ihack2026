import {useEffect, useState} from 'react';
import {View, Text, TextInput, Pressable, Platform, Linking} from 'react-native';
import {LocalServerClient, type TeacherSubmission} from '../services/serverApi';
import type {SchoolClass} from '../db/database';

export function TeacherScreen({classes, onSaved}: {classes: SchoolClass[]; onSaved: () => Promise<void>}) {
  const [reviews, setReviews] = useState<TeacherSubmission[]>([]);
  const [message, setMessage] = useState('');
  const [title, setTitle] = useState('');
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [content, setContent] = useState('');
  const [answer, setAnswer] = useState('');
  const [quizReviews, setQuizReviews] = useState<Awaited<ReturnType<LocalServerClient['quizReviews']>>>([]);
  const [grades, setGrades] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const load = async () => {
    try {
      const client = new LocalServerClient();
      const snapshot = await client.snapshot();
      setReviews((await Promise.all(snapshot.assignments.map(a => client.submissions(a.id)))).flat());
      setQuizReviews((await Promise.all((snapshot.quizzes ?? []).map(q => client.quizReviews(q.id)))).flat());
    } catch(e) {setMessage(String(e));}
  };
  useEffect(() => {void load();}, []);
  return <View style={{gap: 16}}>
    <Text style={{fontSize: 26}}>Teaching workspace</Text>
    {classes.map(c => <Pressable key={c.id} onPress={() => setClassId(c.id)}><Text>{classId === c.id ? '✓ ' : ''}{c.name}</Text></Pressable>)}
    <TextInput placeholder="Assignment title" value={title} onChangeText={setTitle}/>
    <Pressable onPress={async () => {try {await new LocalServerClient().createAssignment({classId, title}); setTitle(''); setMessage('Published'); await onSaved();} catch(e){setMessage(String(e));}}}><Text>Publish assignment</Text></Pressable>
    <Pressable onPress={load}><Text>Refresh submissions</Text></Pressable>
    <TextInput placeholder="Material text or quiz question" multiline value={content} onChangeText={setContent}/>
    <TextInput placeholder="Correct answer (leave empty for a written-answer quiz)" value={answer} onChangeText={setAnswer}/>
    <Pressable onPress={async () => {try {await new LocalServerClient().createMaterial({classId, title, content}); setMessage('Material published'); await onSaved();} catch(e){setMessage(String(e));}}}><Text>Publish as class material</Text></Pressable>
    <Pressable onPress={async () => {try {await new LocalServerClient().createQuiz({classId, title, questions: [{prompt: content, type: 'short_answer', correctAnswer: answer || null, points: 1}]}); setMessage('Written-answer quiz published'); await onSaved();} catch(e){setMessage(String(e));}}}><Text>Publish written-answer quiz</Text></Pressable>
    <Text>{message}</Text>
    {reviews.map(s => <View key={s.id} style={{padding: 16, gap: 12, borderWidth: 1, borderColor: '#ddd'}}>
      <Text>{s.studentName} · {s.status} · {s.gradeValue ?? 'Ungraded'}</Text>
      {s.files.map(f => <Pressable key={f.id} onPress={async () => {try {
        if (Platform.OS === 'web') {
          const blob = await new LocalServerClient().file(f.id);
          const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = f.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
        } else {await Linking.openURL(await new LocalServerClient().downloadFile(f.id, f.name));}
      } catch(e){setMessage(String(e));}}}><Text style={{color: 'blue'}}>Open {f.name}</Text></Pressable>)}
      <Text>{s.feedback.join('\n')}</Text>
      <TextInput placeholder="Grade (0–100)" keyboardType="numeric" value={grades[s.id] ?? ''} onChangeText={v => setGrades({...grades, [s.id]: v})}/>
      <TextInput placeholder="Feedback" multiline value={feedback[s.id] ?? ''} onChangeText={v => setFeedback({...feedback, [s.id]: v})}/>
      {(['graded', 'returned', 'revision_requested'] as const).map(status => <Pressable key={status} onPress={async () => {try {
        await new LocalServerClient().gradeSubmission(s.id, {status, gradeValue: grades[s.id] ? Number(grades[s.id]) : undefined, feedback: feedback[s.id] ?? ''}); await load(); setMessage('Review saved');
      } catch(e){setMessage(String(e));}}}><Text>{status.replace(/_/g, ' ')}</Text></Pressable>)}
    </View>)}
    <Text>Quiz review</Text>
    {quizReviews.map(q => <View key={q.id} style={{gap: 10}}><Text>{q.studentName} · {q.status} · {q.score ?? 'Ungraded'}</Text><Text>{Object.values(q.answers).join('\n')}</Text><TextInput placeholder="Score" keyboardType="numeric" value={grades[q.id] ?? ''} onChangeText={v => setGrades({...grades, [q.id]: v})}/><Pressable onPress={async () => {try {await new LocalServerClient().gradeQuiz(q.id, Number(grades[q.id])); await load();} catch(e){setMessage(String(e));}}}><Text>Save quiz score</Text></Pressable></View>)}
  </View>;
}
