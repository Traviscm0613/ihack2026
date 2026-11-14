import {useEffect, useState} from 'react';
import {View} from 'react-native';
import {Text, TextInput, Pressable, Panel, Caption, Heading} from '../components/WorkspaceUI';
import {LocalServerClient, type AdminOverview, type UserRole} from '../services/serverApi';

export function AdministratorScreen({onSaved}: {onSaved: () => Promise<void>}) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(''); const [role, setRole] = useState<UserRole>('student');
  const [name, setName] = useState(''); const [teacherId, setTeacherId] = useState('');
  const [classId, setClassId] = useState(''); const [userId, setUserId] = useState('');
  const [message, setMessage] = useState('');
  const client = new LocalServerClient();
  const load = async () => {try {setOverview(await client.adminOverview());} catch(e){setMessage(String(e));}};
  const act = async (action: () => Promise<unknown>) => {try {await action(); await load(); await onSaved(); setMessage('Saved on server');} catch(e){setMessage(String(e));}};
  useEffect(() => {void load();}, []);
  return <View style={{gap: 20}}><Heading>School administration</Heading><Caption>Manage your school’s people, classes, and access.</Caption>
    {message ? <Text accessibilityRole="alert">{message}</Text> : null}<Panel><Heading>Create account</Heading>
    <TextInput placeholder="Username" value={username} onChangeText={setUsername}/><TextInput placeholder="Display name" value={displayName} onChangeText={setDisplayName}/><TextInput placeholder="Password" secureTextEntry value={password} onChangeText={setPassword}/>
    {(['student','teacher','administrator'] as UserRole[]).map(r => <Pressable key={r} onPress={() => setRole(r)}><Text>{r === role ? '✓ ' : ''}{r}</Text></Pressable>)}
    <Pressable onPress={() => act(async () => {await client.createUser({username, displayName, password, role}); setPassword('');})}><Text>Create user</Text></Pressable>
    </Panel><Panel><Heading>School directory</Heading><Caption>Select a teacher to assign a class, or a student to enroll.</Caption>
    {overview?.users.map(u => <View key={u.id}><Pressable onPress={() => {setUserId(u.id); if(u.role === 'teacher') setTeacherId(u.id);}}><Text>{u.displayName} · {u.role} {userId === u.id ? '✓' : ''}</Text></Pressable><Pressable onPress={() => act(() => client.updateUser(u.id, {active: !u.active}))}><Text>{u.active ? 'Disable' : 'Enable'}</Text></Pressable></View>)}
    </Panel><Panel><Heading>Classes & enrollment</Heading><TextInput placeholder="New class name" value={name} onChangeText={setName}/>
    <Pressable onPress={() => act(() => client.createClass({name, teacherId}))}><Text>Create class for selected teacher</Text></Pressable>
    {overview?.classes.map(c => <Pressable key={c.id} onPress={() => setClassId(c.id)}><Text>{c.name} {classId === c.id ? '✓' : ''}</Text></Pressable>)}
    <Pressable onPress={() => act(() => client.enroll(classId, userId))}><Text>Enroll selected student in selected class</Text></Pressable>
    <Pressable onPress={() => act(() => client.removeEnrollment(classId, userId))}><Text>Remove selected enrollment</Text></Pressable>
    </Panel><Panel><Heading>School data</Heading><Caption>Save a backup of your school records and files.</Caption><Pressable onPress={() => act(() => client.createBackup())}><Text>Create backup</Text></Pressable></Panel>
  </View>;
}
