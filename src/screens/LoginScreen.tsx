import {useState} from 'react';
import {View, Text, TextInput, Pressable} from 'react-native';
import {LocalServerClient, resolveServerUrl, type Session} from '../services/serverApi';
import {selectUserDatabase} from '../db/database';

export function LoginScreen({onLogin}: {onLogin: (session: Session) => void}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return <View style={{padding: 32, flex: 1, justifyContent: 'center', gap: 16}}>
    <Text style={{fontSize: 30, fontWeight: 'bold'}}>LocalLearn</Text>
    <Text>Sign in with your school account</Text>
    <TextInput accessibilityLabel="Username" placeholder="Username" autoCapitalize="none" value={username} onChangeText={setUsername}/>
    <TextInput accessibilityLabel="Password" placeholder="Password" secureTextEntry value={password} onChangeText={setPassword}/>
    <Pressable disabled={busy} onPress={async () => {
      setBusy(true); setMessage('');
      try {
        if (!await resolveServerUrl()) throw new Error('Cannot reach Photobooth on port 9000. Connect to the school Wi-Fi.');
        const session = await new LocalServerClient().login(username, password);
        await selectUserDatabase(session.user.id);
        setPassword(''); onLogin(session);
      } catch (error) {setMessage(error instanceof Error ? error.message : 'Login failed');}
      finally {setBusy(false);}
    }}><Text style={{color: '#6554c0', fontWeight: 'bold'}}>{busy ? 'Signing in…' : 'Sign in'}</Text></Pressable>
    <Text accessibilityRole="alert">{message}</Text>
  </View>;
}
