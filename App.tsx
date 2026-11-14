import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Dashboard } from './src/screens/Dashboard';
import { NavigationBar } from './src/components/NavigationBar';
import { activeTheme, setTheme, theme, themes, type ThemeName } from './src/theme';
import { assignments } from './src/data/mockData';
import { applyServerSnapshot, getClassDetail, getDashboardData, getPendingChangeCount, initializeDatabase, type DashboardData } from './src/db/database';
import { DebugScreen } from './src/screens/DebugScreen';
import { AssignmentsScreen } from './src/screens/AssignmentsScreen';
import { SubmissionScreen } from './src/screens/SubmissionScreen';
import { ClassesScreen } from './src/screens/ClassesScreen';
import { ClassDetailScreen } from './src/screens/ClassDetailScreen';
import { MaterialViewerScreen } from './src/screens/MaterialViewerScreen';
import { QuizScreen } from './src/screens/QuizScreen';
import { getConfiguredServerCredentials, getConfiguredServerUrl, fetchServerSnapshot, LocalServerClient } from './src/services/serverApi';
import { CalendarScreen } from './src/screens/CalendarScreen';
import { AdministratorScreen } from './src/screens/AdministratorScreen';
import { TeacherScreen } from './src/screens/TeacherScreen';
import { type UserRole } from './src/services/serverApi';
import { syncQueue } from './src/services/syncQueue';

export default function App() {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [role, setRole] = useState<UserRole>('student');
  const [themeVersion, setThemeVersion] = useState(0);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [selectedQuizId, setSelectedQuizId] = useState<string | null>(null);
  const [classDetail, setClassDetail] = useState<Awaited<ReturnType<typeof getClassDetail>> | null>(null);
  const [query, setQuery] = useState('');
  const [databaseState, setDatabaseState] = useState<{ loading: boolean; error: string | null; data: DashboardData | null }>({ loading: true, error: null, data: null });
  const [pendingChanges, setPendingChanges] = useState(0);
  useEffect(() => {
    let active = true;
    initializeDatabase().then(async () => {
      const serverUrl = getConfiguredServerUrl();
      if (serverUrl) {
        try {
          const credentials = getConfiguredServerCredentials();
          if (credentials) await new LocalServerClient(serverUrl).login(credentials.username, credentials.password);
          await applyServerSnapshot(await fetchServerSnapshot(serverUrl));
          await syncQueue.flush(new LocalServerClient(serverUrl));
        } catch (error) {
          console.warn('Raspberry Pi sync unavailable; using the local cache.', error);
        }
      }
      return Promise.all([getDashboardData(), getPendingChangeCount()]);
    }).then(([data, pending]) => {
      if (active) {
        setDatabaseState({ loading: false, error: null, data });
        setPendingChanges(pending);
      }
    }).catch((error) => {
      if (active) setDatabaseState({ loading: false, error: error instanceof Error ? error.message : 'Unable to open the local database.', data: null });
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!selectedClassId) {
      setClassDetail(null);
      return;
    }
    getClassDetail(selectedClassId).then(setClassDetail).catch(() => setClassDetail(null));
  }, [selectedClassId, databaseState.data]);
  const refreshDatabase = async () => {
    const data = await getDashboardData();
    setDatabaseState({ loading: false, error: null, data });
    setPendingChanges(await getPendingChangeCount());
    if (selectedClassId) setClassDetail(await getClassDetail(selectedClassId));
  };
  const filteredAssignments = useMemo(
    () => (databaseState.data?.assignments ?? assignments).filter((item) => item.title.toLowerCase().includes(query.toLowerCase())),
    [databaseState.data, query],
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View key={themeVersion} style={styles.app}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>LocalLearn</Text>
            <Text style={styles.breadcrumb}>BYU Idaho  /  <Text style={styles.breadcrumbStrong}>{activeTab}</Text></Text>
          </View>
          <View style={styles.headerTools}><Pressable style={styles.roleButton} onPress={() => { const next = role === 'student' ? 'teacher' : role === 'teacher' ? 'administrator' : 'student'; setRole(next); setActiveTab(next === 'student' ? 'Dashboard' : 'Workspace'); }}><Text style={styles.roleLabel}>{role}</Text></Pressable><View style={styles.themePicker}><Pressable accessibilityRole="button" accessibilityLabel="Choose theme" onPress={() => setThemeMenuOpen((open) => !open)} style={styles.themePickerButton}><Text style={styles.themePickerLabel}>Theme</Text><Text numberOfLines={1} style={styles.themePickerValue}>{activeTheme}</Text><Text style={styles.themeChevron}>{themeMenuOpen ? '⌃' : '⌄'}</Text></Pressable>{themeMenuOpen ? <View style={styles.themeMenu}>{(Object.keys(themes) as ThemeName[]).map((name) => <Pressable key={name} onPress={() => { setTheme(name); setThemeVersion((version) => version + 1); setThemeMenuOpen(false); }} style={[styles.themeMenuItem, activeTheme === name && styles.themeMenuItemActive]}><View style={[styles.themeMenuSwatch, { backgroundColor: themes[name].colors.violet }]} /><Text style={[styles.themeMenuText, activeTheme === name && styles.themeMenuTextActive]}>{name}</Text>{activeTheme === name ? <Text style={styles.themeCheck}>✓</Text> : null}</Pressable>)}</View> : null}</View><View style={styles.serverIndicator}><View style={styles.pulse} /><Text style={styles.serverText}>Local server</Text></View></View>
        </View>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {databaseState.loading ? <View style={styles.databaseMessage}><ActivityIndicator color={theme.colors.violet} /><Text style={styles.databaseMessageText}>Opening local database…</Text></View> : databaseState.error ? <View style={styles.databaseMessage}><Text style={styles.databaseError}>Local database unavailable</Text><Text style={styles.databaseMessageText}>{databaseState.error}</Text></View> : activeTab === 'Dashboard' ? (
            selectedAssignmentId ? <SubmissionScreen assignment={(databaseState.data?.assignments ?? []).find((item) => item.id === selectedAssignmentId)!} onBack={() => { setSelectedAssignmentId(null); setActiveTab('Assignments'); }} onSubmitted={refreshDatabase} /> : <Dashboard assignments={filteredAssignments} classes={databaseState.data?.classes ?? []} event={databaseState.data?.event ?? null} events={databaseState.data?.events ?? []} pendingChanges={pendingChanges} serverUrl={getConfiguredServerUrl()} query={query} onQueryChange={setQuery} onNavigateCalendar={() => setActiveTab('Calendar')} onSelectAssignment={(assignment) => setSelectedAssignmentId(assignment.id)} onSelectClass={(classId) => { setSelectedClassId(classId); setActiveTab('Classes'); }} onViewAllAssignments={() => setActiveTab('Assignments')} />
          ) : activeTab === 'Calendar' ? (
            <CalendarScreen events={databaseState.data?.events ?? []} onSaved={refreshDatabase} onOpenAssignment={(assignmentId) => { setSelectedAssignmentId(assignmentId); setActiveTab('Assignments'); }} />
           ) : activeTab === 'Workspace' && role === 'administrator' ? (
            <AdministratorScreen onSaved={refreshDatabase} />
          ) : activeTab === 'Workspace' && role === 'teacher' ? (
            <TeacherScreen classes={databaseState.data?.classes ?? []} onSaved={refreshDatabase} />
          ) : activeTab === 'Developer' ? (
            <DebugScreen classes={databaseState.data?.classes ?? []} onSaved={refreshDatabase} />
          ) : activeTab === 'Assignments' ? (
            selectedAssignmentId ? <SubmissionScreen assignment={(databaseState.data?.assignments ?? []).find((item) => item.id === selectedAssignmentId)!} onBack={() => setSelectedAssignmentId(null)} onSubmitted={refreshDatabase} /> : selectedQuizId ? <QuizScreen quiz={(databaseState.data?.quizzes ?? []).find((item) => item.id === selectedQuizId)!} onBack={() => setSelectedQuizId(null)} onSubmitted={refreshDatabase} /> : <AssignmentsScreen assignments={databaseState.data?.assignments ?? []} quizzes={databaseState.data?.quizzes ?? []} completedQuizIds={databaseState.data?.completedQuizIds ?? []} classes={databaseState.data?.classes ?? []} onSelect={(assignment) => setSelectedAssignmentId(assignment.id)} onSelectQuiz={(quiz) => setSelectedQuizId(quiz.id)} />
          ) : activeTab === 'Classes' ? (
            selectedAssignmentId && classDetail ? <SubmissionScreen assignment={classDetail.assignments.find((item) => item.id === selectedAssignmentId)!} onBack={() => setSelectedAssignmentId(null)} onSubmitted={refreshDatabase} /> : selectedMaterialId && classDetail ? <MaterialViewerScreen material={classDetail.materials.find((item) => item.id === selectedMaterialId)!} onBack={() => setSelectedMaterialId(null)} /> : selectedQuizId && classDetail ? <QuizScreen quiz={classDetail.quizzes.find((item) => item.id === selectedQuizId)!} onBack={() => setSelectedQuizId(null)} /> : selectedClassId && classDetail?.classRow ? <ClassDetailScreen classRow={classDetail.classRow} assignments={classDetail.assignments} materials={classDetail.materials} quizzes={classDetail.quizzes} onBack={() => setSelectedClassId(null)} onSelectAssignment={(assignment) => setSelectedAssignmentId(assignment.id)} onSelectMaterial={(material) => setSelectedMaterialId(material.id)} onSelectQuiz={(quiz) => setSelectedQuizId(quiz.id)} /> : <ClassesScreen classes={databaseState.data?.classes ?? []} assignments={databaseState.data?.assignments ?? []} onSelect={(classId) => setSelectedClassId(classId)} />
          ) : null}
        </ScrollView>
        <NavigationBar activeTab={activeTab} onSelect={setActiveTab} role={role} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.page },
  app: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 15, backgroundColor: theme.colors.white, borderBottomWidth: 1, borderBottomColor: theme.colors.line, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 },
  headerTools: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roleButton: { borderWidth: 1, borderColor: theme.colors.violet, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  roleLabel: { color: theme.colors.violet, fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  themePicker: { position: 'relative', zIndex: 20 },
  themePickerButton: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 145, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: theme.colors.white },
  themePickerLabel: { color: theme.colors.muted, fontSize: 9, fontWeight: '800' },
  themePickerValue: { color: theme.colors.ink, fontSize: 9, fontWeight: '800', flexShrink: 1 },
  themeChevron: { color: theme.colors.violet, fontSize: 13, fontWeight: '800' },
  themeMenu: { position: 'absolute', top: 38, right: 0, width: 220, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 10, padding: 6, shadowColor: theme.colors.ink, shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  themeMenuItem: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 8 },
  themeMenuItemActive: { backgroundColor: theme.colors.violetSoft },
  themeMenuSwatch: { width: 15, height: 15, borderRadius: 5 },
  themeMenuText: { color: theme.colors.ink, fontSize: 10, flex: 1 },
  themeMenuTextActive: { color: theme.colors.violet, fontWeight: '800' },
  themeCheck: { color: theme.colors.violet, fontSize: 13, fontWeight: '800' },
  brand: { color: theme.colors.ink, fontSize: 20, fontWeight: '800' },
  breadcrumb: { color: theme.colors.muted, fontSize: 11, marginTop: 4 },
  breadcrumbStrong: { color: theme.colors.ink, fontWeight: '700' },
  serverIndicator: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: theme.colors.greenSoft, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9 },
  pulse: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.green },
  serverText: { color: theme.colors.green, fontSize: 10, fontWeight: '700' },
  content: { padding: 18, paddingBottom: 28 },
  databaseMessage: { alignItems: 'center', paddingVertical: 40 },
  databaseMessageText: { color: theme.colors.muted, fontSize: 12, marginTop: 10, textAlign: 'center' },
  databaseError: { color: '#c45f69', fontSize: 15, fontWeight: '800' },
});
