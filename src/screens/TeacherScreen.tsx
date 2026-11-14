import {useEffect, useState} from 'react';
import {View, Platform, Linking} from 'react-native';
import {Text, TextInput, Pressable, Panel, Heading, Caption} from '../components/WorkspaceUI';
import {theme} from '../theme';
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
  const [studentUsername, setStudentUsername] = useState('');
  const [roster, setRoster] = useState<Awaited<ReturnType<LocalServerClient['roster']>>>([]);
  const [enrolling, setEnrolling] = useState(false);
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
      try {const client = new LocalServerClient(); await client.enrollByUsername(classId, studentUsername.trim()); setRoster(await client.roster(classId)); setStudentUsername(''); setMessage('Student added to your class.');}
      catch(e) {setMessage(String(e));} finally {setEnrolling(false);}
    }}><Text>{enrolling ? 'Adding student…' : '+ Add student'}</Text></Pressable>
    <Caption>{roster.length} enrolled students</Caption>
    {roster.map(student => <View key={student.id} style={{gap: 8, borderTopWidth: 1, borderColor: theme.colors.line, paddingTop: 14}}><Text style={{fontWeight: '700'}}>{student.displayName}</Text><Caption>@{student.username}</Caption><Pressable onPress={async () => {try {const client = new LocalServerClient(); await client.removeEnrollment(classId, student.id); setRoster(await client.roster(classId)); setMessage('Student removed from this class.');} catch(e){setMessage(String(e));}}}><Text>Remove from class</Text></Pressable></View>)}
    </Panel><Panel><Heading>Create learning content</Heading><Caption>Publish an assignment, a reading, or a written-answer quiz to your selected class.</Caption>
    <TextInput placeholder="Title" value={title} onChangeText={setTitle}/>
    <Pressable onPress={async () => {try {await new LocalServerClient().createAssignment({classId, title}); setTitle(''); setMessage('Published'); await onSaved();} catch(e){setMessage(String(e));}}}><Text>Publish assignment</Text></Pressable>
    <Pressable onPress={load}><Text>Refresh submissions</Text></Pressable>
    <TextInput placeholder="Material text or quiz question" multiline value={content} onChangeText={setContent}/>
    <TextInput placeholder="Correct answer (leave empty for a written-answer quiz)" value={answer} onChangeText={setAnswer}/>
    <Pressable onPress={async () => {try {await new LocalServerClient().createMaterial({classId, title, content}); setMessage('Material published'); await onSaved();} catch(e){setMessage(String(e));}}}><Text>Publish as class material</Text></Pressable>
    <Pressable onPress={async () => {try {await new LocalServerClient().createQuiz({classId, title, questions: [{prompt: content, type: 'short_answer', correctAnswer: answer || null, points: 1}]}); setMessage('Written-answer quiz published'); await onSaved();} catch(e){setMessage(String(e));}}}><Text>Publish written-answer quiz</Text></Pressable>
    </Panel><Heading>Submission review</Heading>{!reviews.length ? <Caption>Student submissions will appear here when work is sent.</Caption> : null}
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
        await new LocalServerClient().gradeSubmission(s.id, {status, gradeValue: grades[s.id] ? Number(grades[s.id]) : undefined, feedback: feedback[s.id] ?? ''}); await load(); setMessage('Review saved');
      } catch(e){setMessage(String(e));}}}><Text>{status.replace(/_/g, ' ')}</Text></Pressable>)}
    </Panel>)}
    <Heading>Quiz review</Heading>{!quizReviews.length ? <Caption>No quiz responses to review yet.</Caption> : null}
    {quizReviews.map(q => <Panel key={q.id}><Text>{q.studentName} · {q.status} · {q.score ?? 'Ungraded'}</Text><Text>{Object.values(q.answers).join('\n')}</Text><TextInput placeholder="Score" keyboardType="numeric" value={grades[q.id] ?? ''} onChangeText={v => setGrades({...grades, [q.id]: v})}/><Pressable onPress={async () => {try {await new LocalServerClient().gradeQuiz(q.id, Number(grades[q.id])); await load();} catch(e){setMessage(String(e));}}}><Text>Save quiz score</Text></Pressable></Panel>)}
  </View>;
}
