import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { getLocalUsers, saveLocalUser, setLocalUserActive, type LocalUser } from '../db/database';
import { getConfiguredServerUrl, LocalServerClient, type UserRole } from '../services/serverApi';
import { theme } from '../theme';

export function AdministratorScreen({ onSaved }: { onSaved: () => Promise<void> }) {
  const [users, setUsers] = useState<LocalUser[]>([]);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('student');
  const [message, setMessage] = useState('');
  const [health, setHealth] = useState('Not checked');

  const loadUsers = async () => setUsers(await getLocalUsers());

  useEffect(() => {
    void loadUsers();
  }, []);

  const addUser = async () => {
    if (!username.trim() || !displayName.trim()) return;
    await saveLocalUser({ username: username.trim(), displayName: displayName.trim(), role });
    try {
      if (getConfiguredServerUrl()) {
          await new LocalServerClient().createUser({ username: username.trim(), displayName: displayName.trim(), password, role });
      }
    } catch (_) {
      // The local record remains available until the Pi is connected.
    }
    setUsername('');
    setDisplayName('');
    setPassword('');
    setMessage('Account saved locally. Connect the Raspberry Pi to publish it.');
    await loadUsers();
    await onSaved();
  };

  const createBackup = async () => {
    try {
      const backup = await new LocalServerClient().createBackup();
      setMessage(`Backup ${backup.status}: ${backup.id}`);
    } catch (_) {
      setMessage('Backup request could not reach the Raspberry Pi.');
    }
  };

  const checkHealth = async () => {
    try {
      const result = await new LocalServerClient().health();
      const freeSpace = result.storage ? ` · ${Math.round(result.storage.freeBytes / 1024 / 1024)} MB free` : '';
      setHealth(`${result.status}${freeSpace}`);
    } catch (_) {
      setHealth('Offline / endpoint not configured');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>ADMINISTRATOR</Text>
      <Text style={styles.title}>School control center</Text>
      <Text style={styles.body}>Manage access, local installation health, backups, and the classes shared by the school.</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Create account</Text>
        <TextInput value={displayName} onChangeText={setDisplayName} placeholder="Display name" placeholderTextColor="#a0a9bb" style={styles.input} />
        <TextInput value={username} onChangeText={setUsername} placeholder="Username" placeholderTextColor="#a0a9bb" style={styles.input} />
        <TextInput value={password} onChangeText={setPassword} placeholder="Temporary password" placeholderTextColor="#a0a9bb" secureTextEntry style={styles.input} />
        <View style={styles.chips}>
          {(['student', 'teacher', 'administrator'] as UserRole[]).map((item) => (
            <Pressable key={item} onPress={() => setRole(item)} style={[styles.chip, role === item && styles.selected]}>
              <Text style={[styles.chipText, role === item && styles.selectedText]}>{item}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={styles.button} onPress={addUser}><Text style={styles.buttonText}>Save account</Text></Pressable>
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>
      <View style={styles.card}>
        <View style={styles.row}><Text style={styles.cardTitle}>Users</Text><Text style={styles.muted}>{users.length} local accounts</Text></View>
        {users.map((user) => (
          <View key={user.id} style={styles.userRow}>
            <View style={styles.userCopy}><Text style={styles.userName}>{user.displayName}</Text><Text style={styles.muted}>{user.username} · {user.role}</Text></View>
            <Pressable onPress={async () => { await setLocalUserActive(user.id, !user.active); await loadUsers(); }}>
              <Text style={user.active ? styles.active : styles.inactive}>{user.active ? 'Active' : 'Disabled'}</Text>
            </Pressable>
          </View>
        ))}
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Server operations</Text>
        <Text style={styles.muted}>Health: {health}</Text>
        <View style={styles.actionRow}>
          <Pressable style={styles.secondary} onPress={checkHealth}><Text style={styles.secondaryText}>Check health</Text></Pressable>
          <Pressable style={styles.secondary} onPress={createBackup}><Text style={styles.secondaryText}>Create backup</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingTop: 8 }, eyebrow: { color: theme.colors.violet, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 }, title: { color: theme.colors.ink, fontSize: 27, fontWeight: '800', marginTop: 8 }, body: { color: theme.colors.muted, fontSize: 13, lineHeight: 20, marginTop: 8, marginBottom: 18 }, card: { backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 13, padding: 17, marginBottom: 14 }, cardTitle: { color: theme.colors.ink, fontSize: 15, fontWeight: '800', marginBottom: 12 }, input: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: 8, color: theme.colors.ink, fontSize: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 13 }, chip: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 7 }, selected: { backgroundColor: theme.colors.violetSoft, borderColor: theme.colors.violet }, chipText: { color: theme.colors.muted, fontSize: 10, fontWeight: '700' }, selectedText: { color: theme.colors.violet }, button: { alignItems: 'center', backgroundColor: theme.colors.violet, borderRadius: 8, paddingVertical: 11 }, buttonText: { color: theme.colors.white, fontSize: 11, fontWeight: '800' }, message: { color: theme.colors.green, fontSize: 11, marginTop: 10 }, row: { flexDirection: 'row', justifyContent: 'space-between' }, muted: { color: theme.colors.muted, fontSize: 10 }, userRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: theme.colors.line, paddingVertical: 11 }, userCopy: { flex: 1 }, userName: { color: theme.colors.ink, fontSize: 12, fontWeight: '800', marginBottom: 3 }, active: { color: theme.colors.green, fontSize: 10, fontWeight: '800' }, inactive: { color: theme.colors.orange, fontSize: 10, fontWeight: '800' }, actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 }, secondary: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: 8, padding: 10 }, secondaryText: { color: theme.colors.violet, fontSize: 10, fontWeight: '800' },
});
