import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { createAssignment, getTeacherReviews, saveGrade, type SchoolClass, type TeacherReview } from '../db/database';
import type { SubmissionType } from '../data/mockData';
import { LocalServerClient } from '../services/serverApi';
import { theme } from '../theme';

export function TeacherScreen({ classes, onSaved }: { classes: SchoolClass[]; onSaved: () => Promise<void> }) {
  const [reviews, setReviews] = useState<TeacherReview[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [message, setMessage] = useState('');

  const loadReviews = async () => setReviews(await getTeacherReviews());

  useEffect(() => {
    void loadReviews();
  }, []);

  const publish = async () => {
    const classId = classes[0]?.id;
    if (!title.trim() || !classId) return;
    const input = {
      title: title.trim(), subject: classes[0].name, teacher: 'Demo Teacher',
      dueDate: dueDate || new Date().toISOString().slice(0, 10), completed: false,
      tone: 'math' as const, classId, description: description.trim(),
      submissionTypes: ['file'] as SubmissionType[], grade: null, feedback: null,
    };
    const id = await createAssignment(input);
    try {
      if (process.env.EXPO_PUBLIC_LMS_SERVER_URL) await new LocalServerClient().createAssignment({ ...input, id });
    } catch (_) {
      // The local assignment remains available until the Pi is connected.
    }
    setTitle(''); setDescription(''); setDueDate('');
    setMessage('Assignment saved locally and ready to sync.');
    await onSaved();
  };

  const review = async (item: TeacherReview, status: 'graded' | 'returned' | 'revision_requested') => {
    await saveGrade(item.submission.assignmentId, item.grade ?? 100, item.feedback ?? '', status);
    try {
      if (process.env.EXPO_PUBLIC_LMS_SERVER_URL) {
        await new LocalServerClient().gradeSubmission(item.submission.id, { gradeValue: item.grade ?? 100, feedback: item.feedback ?? '', status });
      }
    } catch (_) {
      // The local review remains queued for synchronization.
    }
    setMessage('Review saved locally.');
    await loadReviews();
    await onSaved();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>TEACHER</Text>
      <Text style={styles.title}>Teaching workspace</Text>
      <Text style={styles.body}>Create work, monitor submissions, and return feedback. The local queue keeps changes safe until the Pi is reachable.</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>New assignment</Text>
        <TextInput value={title} onChangeText={setTitle} placeholder="Assignment title" placeholderTextColor="#a0a9bb" style={styles.input} />
        <TextInput value={description} onChangeText={setDescription} placeholder="Instructions" placeholderTextColor="#a0a9bb" multiline style={[styles.input, styles.multiline]} />
        <TextInput value={dueDate} onChangeText={setDueDate} placeholder="Due date (YYYY-MM-DD)" placeholderTextColor="#a0a9bb" style={styles.input} />
        <Pressable style={styles.button} onPress={publish}><Text style={styles.buttonText}>Publish assignment</Text></Pressable>
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Submission review</Text>
        {reviews.length ? reviews.map((item) => (
          <View key={item.submission.id} style={styles.review}>
            <Text style={styles.reviewTitle}>{item.assignmentTitle}</Text>
            <Text style={styles.muted}>{item.studentName} · {item.submission.fileName}</Text>
            <View style={styles.actionRow}>
              <Pressable style={styles.secondary} onPress={() => review(item, 'graded')}><Text style={styles.secondaryText}>Grade</Text></Pressable>
              <Pressable style={styles.secondary} onPress={() => review(item, 'revision_requested')}><Text style={styles.secondaryText}>Request revision</Text></Pressable>
              <Pressable style={styles.secondary} onPress={() => review(item, 'returned')}><Text style={styles.secondaryText}>Return</Text></Pressable>
            </View>
          </View>
        )) : <Text style={styles.muted}>No locally cached submissions yet. New Pi submissions will appear here after sync.</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingTop: 8 }, eyebrow: { color: theme.colors.violet, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 }, title: { color: theme.colors.ink, fontSize: 27, fontWeight: '800', marginTop: 8 }, body: { color: theme.colors.muted, fontSize: 13, lineHeight: 20, marginTop: 8, marginBottom: 18 }, card: { backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 13, padding: 17, marginBottom: 14 }, cardTitle: { color: theme.colors.ink, fontSize: 15, fontWeight: '800', marginBottom: 12 }, input: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: 8, color: theme.colors.ink, fontSize: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 }, multiline: { minHeight: 68, textAlignVertical: 'top' }, button: { alignItems: 'center', backgroundColor: theme.colors.violet, borderRadius: 8, paddingVertical: 11 }, buttonText: { color: theme.colors.white, fontSize: 11, fontWeight: '800' }, message: { color: theme.colors.green, fontSize: 11, marginTop: 10 }, muted: { color: theme.colors.muted, fontSize: 10 }, review: { borderTopWidth: 1, borderTopColor: theme.colors.line, paddingVertical: 12 }, reviewTitle: { color: theme.colors.ink, fontSize: 12, fontWeight: '800', marginBottom: 3 }, actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }, secondary: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: 8, padding: 9 }, secondaryText: { color: theme.colors.violet, fontSize: 10, fontWeight: '800' },
});
