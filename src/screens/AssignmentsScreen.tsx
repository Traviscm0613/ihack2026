import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { faCheck, faListCheck } from '@fortawesome/free-solid-svg-icons';
import { AppIcon } from '../components/AppIcon';
import { ProgressRing } from '../components/ProgressRing';
import { Assignment, SubmissionType } from '../data/mockData';
import { Quiz, SchoolClass } from '../db/database';
import { theme } from '../theme';

const typeLabels: Record<SubmissionType, string> = { file: 'File', photo: 'Photo', scan: 'Scan' };

export function AssignmentsScreen({ assignments, quizzes, completedQuizIds, classes, onSelect, onSelectQuiz }: { assignments: Assignment[]; quizzes: Quiz[]; completedQuizIds: string[]; classes: SchoolClass[]; onSelect: (assignment: Assignment) => void; onSelectQuiz: (quiz: Quiz) => void }) {
  const [filter, setFilter] = useState<'All' | 'Completed' | 'Not completed'>('Not completed');
  const [dateFilter, setDateFilter] = useState<'This week' | 'This week + next week' | 'All dates'>('This week');
  const classNames = useMemo(() => new Map(classes.map((item) => [item.id, item.name])), [classes]);
  const inDateRange = (dateValue: string) => {
    if (dateFilter === 'All dates') return true;
    const due = new Date(`${dateValue}T12:00:00`);
    const today = new Date();
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
    const end = new Date(monday);
    end.setDate(end.getDate() + (dateFilter === 'This week' ? 6 : 13));
    return due >= monday && due <= end;
  };
  const isVisible = (completed: boolean) => filter === 'All' || filter === 'Completed' && completed || filter === 'Not completed' && !completed;
  const filteredAssignments = assignments.filter((item) => inDateRange(item.dueDate));
  const filteredQuizzes = quizzes.filter((quiz) => inDateRange(quiz.dueDate));
  const visible = filteredAssignments.filter((item) => isVisible(item.completed));
  const visibleQuizzes = filteredQuizzes.filter((quiz) => isVisible(completedQuizIds.includes(quiz.id)));

  return <View>
    <Text style={styles.eyebrow}>YOUR WORK</Text>
    <Text style={styles.title}>Assignments</Text>
    <Text style={styles.subtitle}>Keep track of what’s due across your classes.</Text>
    <View style={styles.overallCard}><ProgressRing completed={filteredAssignments.filter((item) => item.completed).length} total={filteredAssignments.length} color={theme.colors.violet} size={142} strokeWidth={11} /><View style={styles.overallCopy}><Text style={styles.overallEyebrow}>OVERALL PROGRESS</Text><Text style={styles.overallTitle}>Your assignment progress</Text><Text style={styles.overallBody}>Completed work in the selected date range.</Text></View></View>
    <View style={styles.filters}>{(['Not completed', 'Completed', 'All'] as const).map((item) => <Pressable key={item} onPress={() => setFilter(item)} style={[styles.filter, filter === item && styles.activeFilter]}><Text style={[styles.filterText, filter === item && styles.activeFilterText]}>{item}</Text></Pressable>)}</View>
    <View style={styles.filters}>{(['This week', 'This week + next week', 'All dates'] as const).map((item) => <Pressable key={item} onPress={() => setDateFilter(item)} style={[styles.filter, dateFilter === item && styles.activeFilter]}><Text style={[styles.filterText, dateFilter === item && styles.activeFilterText]}>{item}</Text></Pressable>)}</View>
    <Text style={styles.sectionTitle}>Class progress</Text>
    <View style={styles.progressGrid}>{classes.map((item) => { const classAssignments = filteredAssignments.filter((assignment) => assignment.classId === item.id); const completed = classAssignments.filter((assignment) => assignment.completed).length; return <ClassProgress key={item.id} className={item.name} color={item.color} completed={completed} total={classAssignments.length} />; })}</View>
    <View style={styles.card}>{visible.length || visibleQuizzes.length ? <>{visible.map((assignment) => <AssignmentTodo key={assignment.id} assignment={assignment} className={classNames.get(assignment.classId) ?? assignment.subject} onSelect={onSelect} />)}{visibleQuizzes.map((quiz) => <QuizTodo key={quiz.id} quiz={quiz} className={classNames.get(quiz.classId) ?? 'Class'} onSelect={onSelectQuiz} completed />)}</> : <Text style={styles.empty}>Nothing here yet.</Text>}</View>
  </View>;
}

function QuizTodo({ quiz, className, onSelect, completed }: { quiz: Quiz; className: string; onSelect: (quiz: Quiz) => void; completed: boolean }) {
  const dueDate = new Date(`${quiz.dueDate}T12:00:00`);
  const dueLabel = Number.isNaN(dueDate.getTime()) ? quiz.dueDate : dueDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return <Pressable onPress={() => onSelect(quiz)} style={styles.assignment}><View style={[quizStyles.quizIcon, completed && quizStyles.quizIconCompleted]}>{completed ? <AppIcon icon={faCheck} size={11} color={theme.colors.white} /> : <AppIcon icon={faListCheck} size={12} color={theme.colors.violet} />}</View><View style={styles.details}><Text style={styles.assignmentTitle}>{quiz.title}</Text><Text style={styles.className}>{className} · Quiz</Text>{quiz.description ? <Text numberOfLines={2} style={styles.description}>{quiz.description}</Text> : null}<View style={styles.meta}><Text style={styles.due}>Due {dueLabel}</Text><Text style={quizStyles.quizLabel}>{completed ? 'Completed' : `${quiz.questions.length} questions`}</Text></View></View></Pressable>;
}

const quizStyles = { quizIcon: { width: 21, height: 21, borderRadius: 11, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: theme.colors.violetSoft }, quizIconCompleted: { backgroundColor: theme.colors.green }, quizLabel: { color: theme.colors.violet, fontSize: 10, fontWeight: '800' as const } };

function ClassProgress({ className, color, completed, total }: { className: string; color: SchoolClass['color']; completed: number; total: number }) {
  const stroke = { purple: '#8775e9', blue: '#2f82a9', green: '#16866e', orange: '#e05b31' }[color];
  return <View style={styles.progressCard}><ProgressRing completed={completed} total={total} color={stroke} size={68} strokeWidth={6} showCount={false} /><Text numberOfLines={1} style={styles.progressName}>{className}</Text><Text style={styles.progressCount}>{completed}/{total} complete</Text></View>;
}

function AssignmentTodo({ assignment, className, onSelect }: { assignment: Assignment; className: string; onSelect: (assignment: Assignment) => void }) {
  const dueDate = new Date(`${assignment.dueDate}T12:00:00`);
  const dueLabel = Number.isNaN(dueDate.getTime()) ? assignment.due : dueDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const dueSoon = !assignment.completed && assignment.dueDate <= '2026-11-15';
  return <Pressable onPress={() => onSelect(assignment)} style={styles.assignment}><View style={[styles.check, assignment.completed && styles.checked]}>{assignment.completed ? <AppIcon icon={faCheck} size={11} color={theme.colors.white} /> : null}</View><View style={styles.details}><Text style={styles.assignmentTitle}>{assignment.title}</Text><Text style={styles.className}>{className} · {assignment.teacher}</Text>{assignment.description ? <Text numberOfLines={2} style={styles.description}>{assignment.description}</Text> : null}<View style={styles.meta}><Text style={[styles.due, dueSoon && styles.dueSoon]}>Due {dueLabel}</Text>{assignment.grade !== null ? <Text style={styles.grade}>Grade {assignment.grade}%</Text> : null}<View style={styles.types}>{assignment.submissionTypes.map((type) => <Text key={type} style={styles.type}>{typeLabels[type]}</Text>)}</View></View></View></Pressable>;
}

const styles = StyleSheet.create({ eyebrow: { color: theme.colors.violet, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 }, title: { color: theme.colors.ink, fontSize: 28, fontWeight: '800', marginTop: 7 }, subtitle: { color: theme.colors.muted, fontSize: 13, marginTop: 5 }, overallCard: { flexDirection: 'row', alignItems: 'center', gap: 18, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 14, padding: 18, marginTop: 18 }, overallCopy: { flex: 1 }, overallEyebrow: { color: theme.colors.violet, fontSize: 9, fontWeight: '800', letterSpacing: 1 }, overallTitle: { color: theme.colors.ink, fontSize: 16, fontWeight: '800', marginTop: 7 }, overallBody: { color: theme.colors.muted, fontSize: 11, lineHeight: 16, marginTop: 5 }, filters: { flexDirection: 'row', gap: 7, marginVertical: 18 }, filter: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 8 }, activeFilter: { backgroundColor: theme.colors.violet, borderColor: theme.colors.violet }, filterText: { color: theme.colors.muted, fontSize: 10, fontWeight: '700' }, activeFilterText: { color: theme.colors.white }, sectionTitle: { color: theme.colors.ink, fontSize: 16, fontWeight: '800', marginBottom: 10 }, progressGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 18 }, progressCard: { alignItems: 'center', backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 12, padding: 10, width: '31.8%' }, progressName: { color: theme.colors.ink, fontSize: 10, fontWeight: '800', marginTop: 6, maxWidth: 90 }, progressCount: { color: theme.colors.muted, fontSize: 9, marginTop: 3 }, card: { backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 13, paddingHorizontal: 16 }, assignment: { flexDirection: 'row', gap: 11, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#eef0f5' }, check: { width: 21, height: 21, borderWidth: 2, borderColor: '#b9c0ce', borderRadius: 11, marginTop: 2, alignItems: 'center', justifyContent: 'center' }, checked: { backgroundColor: theme.colors.green, borderColor: theme.colors.green }, details: { flex: 1 }, assignmentTitle: { color: theme.colors.ink, fontSize: 14, fontWeight: '800' }, className: { color: theme.colors.muted, fontSize: 10, marginTop: 5 }, description: { color: '#909aae', fontSize: 10, lineHeight: 15, marginTop: 7 }, meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }, due: { color: '#7f8a9f', fontSize: 10, fontWeight: '700' }, dueSoon: { color: theme.colors.orange }, grade: { color: theme.colors.green, fontSize: 10, fontWeight: '800' }, types: { flexDirection: 'row', gap: 5, marginLeft: 'auto' }, type: { backgroundColor: theme.colors.violetSoft, color: theme.colors.violet, borderRadius: 6, fontSize: 9, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 4 }, empty: { color: theme.colors.muted, fontSize: 12, paddingVertical: 22 } });
