import {useEffect, useState} from 'react';
import {View, Platform, Linking} from 'react-native';
import {Text, TextInput, Pressable, Panel, Heading, Caption} from '../components/WorkspaceUI';
import {theme} from '../theme';
import {TeacherComposer} from '../components/TeacherComposer';
import {TeacherClassTools} from '../components/TeacherClassTools';
import type {Assignment} from '../data/mockData';
import {LocalServerClient, type TeacherSubmission} from '../services/serverApi';
import type {SchoolClass} from '../db/database';

export function TeacherScreen({classes, onSaved}: {classes: SchoolClass[]; onSaved: () => Promise<void>}) {
  const [reviews, setReviews] = useState<TeacherSubmission[]>([]);
  const [message, setMessage] = useState('');
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [quizReviews, setQuizReviews] = useState<Awaited<ReturnType<LocalServerClient['quizReviews']>>>([]);
  const [grades, setGrades] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [studentUsername, setStudentUsername] = useState('');
  const [roster, setRoster] = useState<Awaited<ReturnType<LocalServerClient['roster']>>>([]);
  const [enrolling, setEnrolling] = useState(false);
  useEffect(() => {if (!classes.some(c => c.id === classId)) setClassId(classes[0]?.id ?? '');}, [classes]);
  useEffect(() => {
    let active = true;
    setRoster([]);
    if (classId) new LocalServerClient().roster(classId).then(items => {if (active) setRoster(items);}).catch(e => {if (active) setMessage(String(e));});
    return () => {active = false;};
  }, [classId]);
  const load = async () => {
    try {
      const client = new LocalServerClient();
      const snapshot = await client.snapshot();
      setAssignments(snapshot.assignments);
      setReviews((await Promise.all(snapshot.assignments.map(a => client.submissions(a.id)))).flat());
      setQuizReviews((await Promise.all((snapshot.quizzes ?? []).map(q => client.quizReviews(q.id)))).flat());
    } catch(e) {setMessage(String(e));}
  };
  useEffect(() => {void load();}, []);
  return <View style={{gap: 20}}>
    <Heading>Teaching workspace</Heading><Caption>A place to guide your classes, review work, and help students grow.</Caption>
    {message ? <Text accessibilityRole="alert">{message}</Text> : null}
    <Panel><Heading>Your classes</Heading><Caption>Select the class you want to manage.</Caption>
    {classes.map(c => <Pressable key={c.id} onPress={() => setClassId(c.id)}><Text>{classId === c.id ? '✓ ' : ''}{c.name}</Text></Pressable>)}
    {!classes.length ? <Caption>Your administrator will assign your classes here.</Caption> : null}
    </Panel><Panel><Heading>Class roster</Heading><Caption>Add an existing student using their school username.</Caption>
    <TextInput accessibilityLabel="Student username" autoCapitalize="none" placeholder="Student username" value={studentUsername} onChangeText={setStudentUsername}/>
    <Pressable disabled={!classId || !studentUsername.trim() || enrolling} onPress={async () => {
      setEnrolling(true);
      try {const client = new LocalServerClient(); await client.mutate(`/api/classes/${classId}/members`, {username: studentUsername.trim()}); setStudentUsername(''); setMessage('Enrollment saved on this device and queued for sync.'); void onSaved();}
      catch(e) {setMessage(String(e));} finally {setEnrolling(false);}
    }}><Text>{enrolling ? 'Adding student…' : '+ Add student'}</Text></Pressable>
    <Caption>{roster.length} enrolled students</Caption>
    {roster.map(student => <View key={student.id} style={{gap: 8, borderTopWidth: 1, borderColor: theme.colors.line, paddingTop: 14}}><Text style={{fontWeight: '700'}}>{student.displayName}</Text><Caption>@{student.username}</Caption><Pressable onPress={async () => {try {const client = new LocalServerClient(); await client.mutate(`/api/classes/${classId}/members/${student.id}`, {}, 'DELETE'); setRoster(roster.filter(s => s.id !== student.id)); setMessage('Removal queued for sync.'); void onSaved();} catch(e){setMessage(String(e));}}}><Text>Remove from class</Text></Pressable></View>)}
    </Panel>{classes.find(c => c.id === classId) ? <TeacherComposer key={classId} schoolClass={classes.find(c => c.id === classId)!} onSaved={onSaved} onMessage={setMessage}/> : null}<Pressable onPress={load}><Text>Refresh submissions</Text></Pressable><TeacherClassTools classId={classId} onSaved={onSaved} onMessage={setMessage}/><Heading>Missing submissions</Heading>{assignments.filter(a => a.classId === classId).map(a => <Panel key={a.id}><Text>{a.title}</Text><Caption>{roster.filter(student => !reviews.some(r => r.assignmentId === a.id && r.studentId === student.id)).map(s => s.displayName).join(', ') || 'Everyone has submitted.'}</Caption></Panel>)}<Heading>Submission review</Heading>{!reviews.length ? <Caption>Student submissions will appear here when work is sent.</Caption> : null}
    {reviews.map(s => <Panel key={s.id}>
      <Text>{s.studentName} · {s.status} · {s.gradeValue ?? 'Ungraded'}</Text>
      {s.files.map(f => <Pressable key={f.id} onPress={async () => {try {
        if (Platform.OS === 'web') {
          const blob = await new LocalServerClient().file(f.id);
          const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = f.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
        } else {await Linking.openURL(await new LocalServerClient().downloadFile(f.id, f.name));}
      } catch(e){setMessage(String(e));}}}><Text style={{color: theme.colors.violet}}>Open {f.name}</Text></Pressable>)}
      <Text>{s.feedback.join('\n')}</Text>
      <TextInput placeholder="Grade (0–100)" keyboardType="numeric" value={grades[s.id] ?? ''} onChangeText={v => setGrades({...grades, [s.id]: v})}/>
      <TextInput placeholder="Feedback" multiline value={feedback[s.id] ?? ''} onChangeText={v => setFeedback({...feedback, [s.id]: v})}/>
      {(['graded', 'returned', 'revision_requested'] as const).map(status => <Pressable key={status} onPress={async () => {try {
        await new LocalServerClient().mutate(`/api/submissions/${s.id}/grade`, {status, gradeValue: grades[s.id] ? Number(grades[s.id]) : undefined, feedback: feedback[s.id] ?? ''}); void onSaved(); setMessage('Review saved on this device and queued for sync.');
      } catch(e){setMessage(String(e));}}}><Text>{status.replace(/_/g, ' ')}</Text></Pressable>)}
    </Panel>)}
    <Heading>Quiz review</Heading>{!quizReviews.length ? <Caption>No quiz responses to review yet.</Caption> : null}
    {quizReviews.map(q => <Panel key={q.id}><Text>{q.studentName} · {q.status} · {q.score ?? 'Ungraded'}</Text><Text>{Object.values(q.answers).join('\n')}</Text><TextInput placeholder="Score" keyboardType="numeric" value={grades[q.id] ?? ''} onChangeText={v => setGrades({...grades, [q.id]: v})}/><Pressable onPress={async () => {try {await new LocalServerClient().mutate(`/api/quiz-attempts/${q.id}/grade`, {score: Number(grades[q.id])}); void onSaved(); setMessage('Quiz grade queued for sync.');} catch(e){setMessage(String(e));}}}><Text>Save quiz score</Text></Pressable></Panel>)}
  </View>;
}
