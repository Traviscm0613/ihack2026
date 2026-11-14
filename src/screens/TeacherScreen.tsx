import {useEffect, useRef, useState} from 'react';
import {View, Platform, Linking} from 'react-native';
import {Text, TextInput, Pressable, Panel, Heading, Caption} from '../components/WorkspaceUI';
import {theme} from '../theme';
import {TeacherComposer} from '../components/TeacherComposer';
import {TeacherAssistedSubmission} from '../components/TeacherAssistedSubmission';
import type {Assignment} from '../data/mockData';
import {LocalServerClient, type TeacherSubmission} from '../services/serverApi';
import type {SchoolClass} from '../db/database';

export function TeacherScreen({classes, onSaved}: {classes: SchoolClass[]; onSaved: () => Promise<void>}) {
  const [section, setSection] = useState<'Create' | 'Students' | 'Review' | 'Submit for student'>('Create');
  const loadVersion = useRef(0);
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
  const load = async () => {
    const version = ++loadVersion.current;
    try {
      const client = new LocalServerClient();
      const snapshot = await client.snapshot();
      const assignments = snapshot.assignments.filter(a => a.classId === classId);
      const [members, submissions, quizzes] = await Promise.all([
        classId ? client.roster(classId) : Promise.resolve([]),
        section === 'Review' ? Promise.all(assignments.map(a => client.submissions(a.id))) : Promise.resolve([]),
        section === 'Review' ? Promise.all((snapshot.quizzes ?? []).filter(q => q.classId === classId).map(q => client.quizReviews(q.id))) : Promise.resolve([]),
      ]);
      if (version !== loadVersion.current) return;
      setAssignments(assignments);
      setRoster(members);
      setReviews(submissions.flat());
      setQuizReviews(quizzes.flat());
    } catch(e) {if (version === loadVersion.current) setMessage(String(e));}
  };
  useEffect(() => {
    setRoster([]); setAssignments([]); setReviews([]); setQuizReviews([]);
    void load();
    return () => {loadVersion.current++;};
  }, [classId, section]);
  return <View style={{gap: 20}}>
    <Heading>Teaching workspace</Heading><Caption>A place to guide your classes, review work, and help students grow.</Caption>
    {message ? <Text accessibilityRole="alert">{message}</Text> : null}
    <Panel><Heading>Your classes</Heading><Caption>Select the class you want to manage.</Caption>
    {classes.map(c => <Pressable key={c.id} onPress={() => setClassId(c.id)}><Text>{classId === c.id ? '✓ ' : ''}{c.name}</Text></Pressable>)}
    {!classes.length ? <Caption>Your administrator will assign your classes here.</Caption> : null}
    </Panel>
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
      {(['Create', 'Students', 'Review', 'Submit for student'] as const).map(tab =>
        <Pressable key={tab} accessibilityState={{selected: section === tab}} onPress={() => setSection(tab)}>
          <Text>{section === tab ? '✓ ' : ''}{tab}</Text>
        </Pressable>)}
    </View>
    {section === 'Students' ? <Panel><Heading>Class roster</Heading><Caption>Add an existing student using their school username.</Caption>
    <TextInput accessibilityLabel="Student username" autoCapitalize="none" placeholder="Student username" value={studentUsername} onChangeText={setStudentUsername}/>
    <Pressable disabled={!classId || !studentUsername.trim() || enrolling} onPress={async () => {
      setEnrolling(true);
      try {const client = new LocalServerClient(); await client.mutate(`/api/classes/${classId}/members`, {username: studentUsername.trim()}); setStudentUsername(''); setMessage('Enrollment saved on this device and queued for sync.'); void onSaved();}
      catch(e) {setMessage(String(e));} finally {setEnrolling(false);}
    }}><Text>{enrolling ? 'Adding student…' : '+ Add student'}</Text></Pressable>
    <Caption>{roster.length} enrolled students</Caption>
    {roster.map(student => <View key={student.id} style={{gap: 8, borderTopWidth: 1, borderColor: theme.colors.line, paddingTop: 14}}><Text style={{fontWeight: '700'}}>{student.displayName}</Text><Caption>@{student.username}</Caption><Pressable onPress={async () => {try {const client = new LocalServerClient(); await client.mutate(`/api/classes/${classId}/members/${student.id}`, {}, 'DELETE'); setRoster(roster.filter(s => s.id !== student.id)); setMessage('Removal queued for sync.'); void onSaved();} catch(e){setMessage(String(e));}}}><Text>Remove from class</Text></Pressable></View>)}
    </Panel> : null}<View style={{display: section === 'Create' ? 'flex' : 'none'}}>{classes.find(c => c.id === classId) ? <TeacherComposer key={classId} schoolClass={classes.find(c => c.id === classId)!} students={roster} onSaved={onSaved} onMessage={setMessage}/> : <Caption>Select a class to create an assignment.</Caption>}</View>{section === 'Review' ? <Pressable onPress={load}><Text>Refresh submissions</Text></Pressable> : null}{section === 'Submit for student' && classId ? <TeacherAssistedSubmission key={classId} classId={classId} assignments={assignments} students={roster} onSaved={onSaved} onMessage={setMessage}/> : null}{section === 'Review' ? <><Heading>Missing submissions</Heading>{assignments.filter(a => a.classId === classId).map(a => <Panel key={a.id}><Text>{a.title}</Text><Caption>{roster.filter(student => (!a.recipientIds?.length || a.recipientIds.includes(student.id)) && !reviews.some(r => r.assignmentId === a.id && r.studentId === student.id)).map(s => s.displayName).join(', ') || 'Everyone has submitted.'}</Caption></Panel>)}<Heading>Submission review</Heading>{!reviews.length ? <Caption>Student submissions will appear here when work is sent.</Caption> : null}
    {reviews.map(s => <Panel key={s.id}>
      <Text>{s.studentName} · {s.status} · {s.gradeValue ?? s.gradeLabel ?? 'Ungraded'}</Text>
      {s.files.map(f => <Pressable key={f.id} onPress={async () => {try {
        if (Platform.OS === 'web') {
          const blob = await new LocalServerClient().file(f.id);
          const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = f.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
        } else {await Linking.openURL(await new LocalServerClient().downloadFile(f.id, f.name));}
      } catch(e){setMessage(String(e));}}}><Text style={{color: theme.colors.violet}}>Open {f.name}</Text></Pressable>)}
      <Text>{s.feedback.join('\n')}</Text>
      <TextInput placeholder="Grade (e.g. 92 or A)" value={grades[s.id] ?? String(s.gradeValue ?? s.gradeLabel ?? '')} onChangeText={v => setGrades({...grades, [s.id]: v})}/>
      <TextInput placeholder="Feedback" multiline value={feedback[s.id] ?? ''} onChangeText={v => setFeedback({...feedback, [s.id]: v})}/>
      {(['graded', 'returned', 'revision_requested'] as const).map(status => <Pressable key={status} onPress={async () => {try {
        const entered = (grades[s.id] ?? String(s.gradeValue ?? s.gradeLabel ?? '')).trim();
        await new LocalServerClient().mutate(`/api/submissions/${s.id}/grade`, {status, gradeValue: entered && Number.isFinite(Number(entered)) ? Number(entered) : undefined, gradeLabel: entered && !Number.isFinite(Number(entered)) ? entered : undefined, feedback: feedback[s.id] ?? ''}); void onSaved(); setMessage('Review saved on this device and queued for sync.');
      } catch(e){setMessage(String(e));}}}><Text>{status.replace(/_/g, ' ')}</Text></Pressable>)}
    </Panel>)}
    <Heading>Quiz review</Heading>{!quizReviews.length ? <Caption>No quiz responses to review yet.</Caption> : null}
    {quizReviews.map(q => <Panel key={q.id}><Text>{q.studentName} · {q.status} · {q.score ?? 'Ungraded'}</Text><Text>{Object.values(q.answers).join('\n')}</Text><TextInput placeholder="Score" keyboardType="numeric" value={grades[q.id] ?? ''} onChangeText={v => setGrades({...grades, [q.id]: v})}/><Pressable onPress={async () => {try {await new LocalServerClient().mutate(`/api/quiz-attempts/${q.id}/grade`, {score: Number(grades[q.id])}); void onSaved(); setMessage('Quiz grade queued for sync.');} catch(e){setMessage(String(e));}}}><Text>Save quiz score</Text></Pressable></Panel>)}
    </> : null}
  </View>;
}
