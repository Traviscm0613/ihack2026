import {useState} from 'react';
import {View, ScrollView, KeyboardAvoidingView, Platform} from 'react-native';
import {Text, TextInput, Pressable, Panel, Caption} from '../components/WorkspaceUI';
import {theme} from '../theme';
import {LocalServerClient, resolveServerUrl, type Session} from '../services/serverApi';
import {selectUserDatabase} from '../db/database';

export function LoginScreen({onLogin}: {onLogin: (session: Session) => void}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return <KeyboardAvoidingView style={{flex: 1, backgroundColor: theme.colors.page}} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={{flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24}} keyboardShouldPersistTaps="handled">
    <View style={{width: '100%', maxWidth: 440, gap: 24}}>
    <View style={{alignItems: 'center', gap: 10}}><View style={{width: 58, height: 58, borderRadius: 18, backgroundColor: theme.colors.violetSoft, justifyContent: 'center', alignItems: 'center'}}><Text style={{color: theme.colors.violet, fontSize: 25, fontWeight: '800'}}>P</Text></View><Text style={{fontSize: 30, lineHeight: 38, fontWeight: '800'}}>Pidea</Text><Caption>Your classroom, connected.</Caption></View>
    <Panel><Text style={{fontSize: 23, lineHeight: 30, fontWeight: '700'}}>Welcome back</Text>
    <Caption>Sign in with the account provided by your school.</Caption>
    <Text>Username</Text>
    <TextInput accessibilityLabel="Username" placeholder="Username" autoCapitalize="none" value={username} onChangeText={setUsername}/>
    <Text>Password</Text><TextInput accessibilityLabel="Password" placeholder="Your password" secureTextEntry value={password} onChangeText={setPassword}/>
    <Pressable disabled={busy || !username.trim() || !password} onPress={async () => {
      setBusy(true); setMessage('');
      try {
        if (!await resolveServerUrl()) throw new Error('Cannot reach Photobooth on port 9000. Connect to the school Wi-Fi.');
        const session = await new LocalServerClient().login(username, password);
        await selectUserDatabase(session.user.id);
        setPassword(''); onLogin(session);
      } catch (error) {setMessage(error instanceof Error ? error.message : 'Login failed');}
      finally {setBusy(false);}
    }}><Text style={{color: theme.colors.violet, fontWeight: '700'}}>{busy ? 'Signing in…' : 'Sign in →'}</Text></Pressable>
    {message ? <Text accessibilityRole="alert" style={{color: theme.colors.orange}}>{message}</Text> : null}</Panel>
    <View style={{alignItems: 'center'}}><Caption>Connect to your school’s Wi-Fi to sign in.</Caption></View>
    </View></ScrollView></KeyboardAvoidingView>;
}
