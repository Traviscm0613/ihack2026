import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ProgressRing } from '../components/ProgressRing';
import { AppIcon } from '../components/AppIcon';
import { faArrowRight } from '@fortawesome/free-solid-svg-icons';
import { Assignment } from '../data/mockData';
import { SchoolClass } from '../db/database';
import { theme } from '../theme';

const colors = { purple: '#8775e9', blue: '#2f82a9', green: '#16866e', orange: '#e05b31' };

export function ClassesScreen({ classes, assignments, onSelect }: { classes: SchoolClass[]; assignments: Assignment[]; onSelect: (classId: string) => void }) {
  return <View>
    <Text style={styles.eyebrow}>YOUR SCHEDULE</Text>
    <Text style={styles.title}>My classes</Text>
    {classes.map((item) => <Pressable style={styles.card} key={item.id} onPress={() => onSelect(item.id)}><View style={styles.cardHeader}><View style={[styles.stripe, { backgroundColor: colors[item.color] }]} /><View style={styles.info}><Text style={styles.className}>{item.name}</Text><Text style={styles.teacher}>{item.sectionName ? `${item.sectionName} · ` : ''}{item.teacher}</Text></View></View><View style={styles.open}><Text style={styles.openText}>Open class</Text><AppIcon icon={faArrowRight} size={10} color={theme.colors.violet} /></View></Pressable>)}
    {!classes.length ? <View style={styles.empty}><Text style={styles.emptyTitle}>No classes yet</Text><Text style={styles.emptyBody}>Add a class from the Developer tab to start building the roster.</Text></View> : null}
  </View>;
}

const styles = StyleSheet.create({ eyebrow: { color: theme.colors.violet, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 }, title: { color: theme.colors.ink, fontSize: 28, fontWeight: '800', marginTop: 7 }, subtitle: { color: theme.colors.muted, fontSize: 13, marginTop: 5 }, summary: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.colors.violetSoft, borderRadius: 12, padding: 15, marginVertical: 18 }, summaryNumber: { color: theme.colors.violet, fontSize: 28, fontWeight: '800' }, summaryTitle: { color: theme.colors.ink, fontSize: 13, fontWeight: '800' }, summaryBody: { color: theme.colors.muted, fontSize: 10, marginTop: 3 }, card: { backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 13, padding: 16, marginBottom: 12 }, cardHeader: { flexDirection: 'row', alignItems: 'center' }, stripe: { width: 6, height: 38, borderRadius: 4, marginRight: 11 }, info: { flex: 1 }, className: { color: theme.colors.ink, fontSize: 15, fontWeight: '800' }, teacher: { color: theme.colors.muted, fontSize: 10, marginTop: 5 }, grade: { color: theme.colors.ink, fontSize: 13, fontWeight: '800' }, progressRow: { flexDirection: 'row', alignItems: 'center', gap: 16, borderTopWidth: 1, borderTopColor: theme.colors.line, paddingTop: 15, marginTop: 15 }, progressCopy: { flex: 1 }, progressTitle: { color: theme.colors.ink, fontSize: 12, fontWeight: '800' }, progressBody: { color: theme.colors.muted, fontSize: 10, marginTop: 5 }, open: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 13 }, openText: { color: theme.colors.violet, fontSize: 10, fontWeight: '800' }, empty: { backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 13, padding: 20 }, emptyTitle: { color: theme.colors.ink, fontSize: 15, fontWeight: '800' }, emptyBody: { color: theme.colors.muted, fontSize: 12, lineHeight: 18, marginTop: 7 } });
