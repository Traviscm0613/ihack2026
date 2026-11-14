import {useEffect, useState} from 'react';
import {View} from 'react-native';
import {Text, TextInput, Pressable, Panel, Caption, Heading} from '../components/WorkspaceUI';
import {LocalServerClient, type AdminOverview, type UserRole} from '../services/serverApi';

export function AdministratorScreen({onSaved}: {onSaved: () => Promise<void>}) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(''); const [role, setRole] = useState<UserRole>('student');
  const [sectionName, setSectionName] = useState(''); const [name, setName] = useState(''); const [teacherId, setTeacherId] = useState('');
  const [classId, setClassId] = useState(''); const [userId, setUserId] = useState('');
  const [message, setMessage] = useState('');
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const client = new LocalServerClient();
  const load = async () => {try {setOverview(await client.adminOverview());} catch(e){setMessage(String(e));}};
  const act = async (action: () => Promise<unknown>) => {try {await action(); setMessage('Saved locally and queued. Changes apply when the Pi is reachable.'); void onSaved().then(load);} catch(e){setMessage(String(e));}};
  useEffect(() => {void load();}, []);
  return <View style={{gap: 20}}><Heading>School administration</Heading><Caption>Manage your school’s people, classes, and access.</Caption>
    {message ? <Text accessibilityRole="alert">{message}</Text> : null}<Panel><Heading>Create account</Heading>
    <TextInput placeholder="Username" value={username} onChangeText={setUsername}/><TextInput placeholder="Display name" value={displayName} onChangeText={setDisplayName}/><TextInput placeholder="Password" secureTextEntry value={password} onChangeText={setPassword}/>
    {(['student','teacher','administrator'] as UserRole[]).map(r => <Pressable key={r} onPress={() => setRole(r)}><Text>{r === role ? '✓ ' : ''}{r}</Text></Pressable>)}
    <Pressable onPress={() => act(async () => {await client.mutate('/api/admin/users', {username, displayName, password, role}); setPassword('');})}><Text>Create user</Text></Pressable>
    </Panel><Panel><Heading>School directory</Heading><Caption>Select a teacher to assign a class, or a student to enroll.</Caption>
    {overview?.users.map(u => <View key={u.id}><Pressable onPress={() => {setUserId(u.id); if(u.role === 'teacher') setTeacherId(u.id);}}><Text>{u.displayName} · {u.role} {userId === u.id ? '✓' : ''}</Text></Pressable><Pressable onPress={() => act(() => client.mutate(`/api/admin/users/${u.id}`, {active: !u.active}, 'PATCH'))}><Text>{u.active ? 'Disable' : 'Enable'}</Text></Pressable></View>)}
    </Panel><Panel><Heading>Classes & enrollment</Heading><TextInput placeholder="New class name" value={name} onChangeText={setName}/>
    <TextInput placeholder="Section (optional)" value={sectionName} onChangeText={setSectionName}/><Pressable onPress={() => act(() => client.mutate('/api/classes', {name, teacherId, sectionName: sectionName.trim() || null}))}><Text>Create class for selected teacher</Text></Pressable>
    {overview?.classes.map(c => <Pressable key={c.id} onPress={() => setClassId(c.id)}><Text>{c.name} {classId === c.id ? '✓' : ''}</Text></Pressable>)}
    <Pressable onPress={() => act(() => client.mutate(`/api/classes/${classId}/members`, {userId}))}><Text>Enroll selected student in selected class</Text></Pressable>
    <Pressable onPress={() => act(() => client.mutate(`/api/classes/${classId}/members/${userId}`, {}, 'DELETE'))}><Text>Remove selected enrollment</Text></Pressable>
    </Panel><Panel><Heading>School data</Heading>{overview?.health.storage ? <Caption>Server storage: {(overview.health.storage.freeBytes / 1073741824).toFixed(1)} GB free of {(overview.health.storage.totalBytes / 1073741824).toFixed(1)} GB{overview.health.status === 'degraded' ? ' · Storage is running low' : ''}</Caption> : null}<Caption>Save a backup of your school records and files.</Caption><Pressable onPress={() => act(() => client.mutate('/api/admin/backups', {}))}><Text>Create backup</Text></Pressable>{overview?.pendingBackups.filter(b => b.status === 'complete').map(b => <Pressable key={b.id} onPress={() => setRestoreId(b.id)}><Text>Restore backup from {new Date(b.createdAt).toLocaleString()}</Text></Pressable>)}</Panel>{restoreId ? <Panel><Heading>Restore school data?</Heading><Caption>This replaces school records and files with the selected backup. The request runs when the Pi is reachable.</Caption><Pressable onPress={() => {void act(() => client.mutate(`/api/admin/backups/${restoreId}/restore`, {})); setRestoreId(null);}}><Text>Confirm restore</Text></Pressable><Pressable onPress={() => setRestoreId(null)}><Text>Cancel</Text></Pressable></Panel> : null}
  </View>;
}
