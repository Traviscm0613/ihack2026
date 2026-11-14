import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { createAssignment, createEvent } from '../db/database';
import { theme } from '../theme';

export function DebugScreen({ onSaved }: { onSaved: () => Promise<void> }) {
  const [assignmentTitle, setAssignmentTitle] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [date, setDate] = useState('2026-11-21');
  const [message, setMessage] = useState('');

  const addAssignment = async () => {
    if (!assignmentTitle.trim()) return setMessage('Enter an assignment title first.');
    await createAssignment({ title: assignmentTitle.trim(), subject: 'Test subject', teacher: 'Developer tool', due: 'Due Nov 30, 2026', progress: 0, status: 'In progress', tone: 'math' });
    setAssignmentTitle('');
    setMessage('Assignment added to SQLite.');
    await onSaved();
  };

  const addEvent = async () => {
    if (!eventTitle.trim()) return setMessage('Enter an event title first.');
    await createEvent({ title: eventTitle.trim(), date, kind: 'school' });
    setEventTitle('');
    setMessage('Event added to SQLite.');
    await onSaved();
  };

  return <View style={styles.container}>
    <Text style={styles.eyebrow}>DEVELOPER TOOLS</Text>
    <Text style={styles.title}>Local database test data</Text>
    <Text style={styles.body}>Use this screen while the Raspberry Pi API is being built. Records are written directly to the device SQLite database.</Text>
    <View style={styles.card}><Text style={styles.cardTitle}>Add assignment</Text><TextInput value={assignmentTitle} onChangeText={setAssignmentTitle} placeholder="Assignment title" placeholderTextColor="#a0a9bb" style={styles.input} /><Pressable style={styles.button} onPress={addAssignment}><Text style={styles.buttonText}>Save assignment</Text></Pressable></View>
    <View style={styles.card}><Text style={styles.cardTitle}>Add calendar event</Text><TextInput value={eventTitle} onChangeText={setEventTitle} placeholder="Event title" placeholderTextColor="#a0a9bb" style={styles.input} /><TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor="#a0a9bb" style={styles.input} /><Pressable style={styles.button} onPress={addEvent}><Text style={styles.buttonText}>Save event</Text></Pressable></View>
    {message ? <Text style={styles.message}>{message}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({ container: { paddingTop: 8 }, eyebrow: { color: theme.colors.violet, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 }, title: { color: theme.colors.ink, fontSize: 26, fontWeight: '800', marginTop: 8 }, body: { color: theme.colors.muted, fontSize: 13, lineHeight: 20, marginTop: 8, marginBottom: 18 }, card: { backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 13, padding: 17, marginBottom: 14 }, cardTitle: { color: theme.colors.ink, fontSize: 15, fontWeight: '800', marginBottom: 12 }, input: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: 8, color: theme.colors.ink, fontSize: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 }, button: { alignItems: 'center', backgroundColor: theme.colors.violet, borderRadius: 8, paddingVertical: 11 }, buttonText: { color: theme.colors.white, fontSize: 11, fontWeight: '800' }, message: { color: theme.colors.green, fontSize: 12, fontWeight: '700', textAlign: 'center' } });
