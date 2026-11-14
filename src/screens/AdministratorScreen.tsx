import {useEffect, useState} from 'react';
import {View, Text, TextInput, Pressable} from 'react-native';
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
  return <View style={{gap: 14}}><Text style={{fontSize: 26}}>School administration</Text>
    <Text>{message}</Text><Text>Create account</Text>
    <TextInput placeholder="Username" value={username} onChangeText={setUsername}/><TextInput placeholder="Display name" value={displayName} onChangeText={setDisplayName}/><TextInput placeholder="Password" secureTextEntry value={password} onChangeText={setPassword}/>
    {(['student','teacher','administrator'] as UserRole[]).map(r => <Pressable key={r} onPress={() => setRole(r)}><Text>{r === role ? '✓ ' : ''}{r}</Text></Pressable>)}
    <Pressable onPress={() => act(async () => {await client.createUser({username, displayName, password, role}); setPassword('');})}><Text>Create user</Text></Pressable>
    <Text>Users (select a teacher for a new class, or a student to enroll)</Text>
    {overview?.users.map(u => <View key={u.id}><Pressable onPress={() => {setUserId(u.id); if(u.role === 'teacher') setTeacherId(u.id);}}><Text>{u.displayName} · {u.role} {userId === u.id ? '✓' : ''}</Text></Pressable><Pressable onPress={() => act(() => client.updateUser(u.id, {active: !u.active}))}><Text>{u.active ? 'Disable' : 'Enable'}</Text></Pressable></View>)}
    <TextInput placeholder="New class name" value={name} onChangeText={setName}/>
    <Pressable onPress={() => act(() => client.createClass({name, teacherId}))}><Text>Create class for selected teacher</Text></Pressable>
    {overview?.classes.map(c => <Pressable key={c.id} onPress={() => setClassId(c.id)}><Text>{c.name} {classId === c.id ? '✓' : ''}</Text></Pressable>)}
    <Pressable onPress={() => act(() => client.enroll(classId, userId))}><Text>Enroll selected student in selected class</Text></Pressable>
    <Pressable onPress={() => act(() => client.removeEnrollment(classId, userId))}><Text>Remove selected enrollment</Text></Pressable>
    <Pressable onPress={() => act(() => client.createBackup())}><Text>Create backup</Text></Pressable>
  </View>;
}
