import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Dashboard } from './src/screens/Dashboard';
import { NavigationBar } from './src/components/NavigationBar';
import { theme } from './src/theme';
import { assignments } from './src/data/mockData';
import { applyServerSnapshot, getClassDetail, getDashboardData, initializeDatabase, type DashboardData } from './src/db/database';
import { DebugScreen } from './src/screens/DebugScreen';
import { AssignmentsScreen } from './src/screens/AssignmentsScreen';
import { SubmissionScreen } from './src/screens/SubmissionScreen';
import { ClassesScreen } from './src/screens/ClassesScreen';
import { ClassDetailScreen } from './src/screens/ClassDetailScreen';
import { MaterialViewerScreen } from './src/screens/MaterialViewerScreen';
import { QuizScreen } from './src/screens/QuizScreen';
import { getConfiguredServerUrl, fetchServerSnapshot } from './src/services/serverApi';
import { CalendarScreen } from './src/screens/CalendarScreen';

export default function App() {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [selectedQuizId, setSelectedQuizId] = useState<string | null>(null);
  const [classDetail, setClassDetail] = useState<Awaited<ReturnType<typeof getClassDetail>> | null>(null);
  const [query, setQuery] = useState('');
  const [databaseState, setDatabaseState] = useState<{ loading: boolean; error: string | null; data: DashboardData | null }>({ loading: true, error: null, data: null });
  useEffect(() => {
    let active = true;
    initializeDatabase().then(async () => {
      const serverUrl = getConfiguredServerUrl();
      if (serverUrl) {
        try {
          await applyServerSnapshot(await fetchServerSnapshot(serverUrl));
        } catch (error) {
          console.warn('Raspberry Pi sync unavailable; using the local cache.', error);
        }
      }
      return getDashboardData();
    }).then((data) => {
      if (active) setDatabaseState({ loading: false, error: null, data });
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
    if (selectedClassId) setClassDetail(await getClassDetail(selectedClassId));
  };
  const filteredAssignments = useMemo(
    () => (databaseState.data?.assignments ?? assignments).filter((item) => item.title.toLowerCase().includes(query.toLowerCase())),
    [databaseState.data, query],
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.app}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>LocalLearn</Text>
            <Text style={styles.breadcrumb}>My school  /  <Text style={styles.breadcrumbStrong}>{activeTab}</Text></Text>
          </View>
          <View style={styles.serverIndicator}><View style={styles.pulse} /><Text style={styles.serverText}>Local server</Text></View>
        </View>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {databaseState.loading ? <View style={styles.databaseMessage}><ActivityIndicator color={theme.colors.violet} /><Text style={styles.databaseMessageText}>Opening local database…</Text></View> : databaseState.error ? <View style={styles.databaseMessage}><Text style={styles.databaseError}>Local database unavailable</Text><Text style={styles.databaseMessageText}>{databaseState.error}</Text></View> : activeTab === 'Dashboard' ? (
            <Dashboard assignments={filteredAssignments} classes={databaseState.data?.classes ?? []} event={databaseState.data?.event ?? null} events={databaseState.data?.events ?? []} query={query} onQueryChange={setQuery} onNavigateCalendar={() => setActiveTab('Calendar')} />
          ) : activeTab === 'Calendar' ? (
            <CalendarScreen events={databaseState.data?.events ?? []} onSaved={refreshDatabase} />
          ) : activeTab === 'Developer' ? (
            <DebugScreen classes={databaseState.data?.classes ?? []} onSaved={refreshDatabase} />
          ) : activeTab === 'Assignments' ? (
            selectedAssignmentId ? <SubmissionScreen assignment={(databaseState.data?.assignments ?? []).find((item) => item.id === selectedAssignmentId)!} onBack={() => setSelectedAssignmentId(null)} onSubmitted={refreshDatabase} /> : <AssignmentsScreen assignments={databaseState.data?.assignments ?? []} classes={databaseState.data?.classes ?? []} onSelect={(assignment) => setSelectedAssignmentId(assignment.id)} />
          ) : activeTab === 'Classes' ? (
            selectedAssignmentId && classDetail ? <SubmissionScreen assignment={classDetail.assignments.find((item) => item.id === selectedAssignmentId)!} onBack={() => setSelectedAssignmentId(null)} onSubmitted={refreshDatabase} /> : selectedMaterialId && classDetail ? <MaterialViewerScreen material={classDetail.materials.find((item) => item.id === selectedMaterialId)!} onBack={() => setSelectedMaterialId(null)} /> : selectedQuizId && classDetail ? <QuizScreen quiz={classDetail.quizzes.find((item) => item.id === selectedQuizId)!} onBack={() => setSelectedQuizId(null)} /> : selectedClassId && classDetail?.classRow ? <ClassDetailScreen classRow={classDetail.classRow} assignments={classDetail.assignments} materials={classDetail.materials} quizzes={classDetail.quizzes} onBack={() => setSelectedClassId(null)} onSelectAssignment={(assignment) => setSelectedAssignmentId(assignment.id)} onSelectMaterial={(material) => setSelectedMaterialId(material.id)} onSelectQuiz={(quiz) => setSelectedQuizId(quiz.id)} /> : <ClassesScreen classes={databaseState.data?.classes ?? []} assignments={databaseState.data?.assignments ?? []} onSelect={(classId) => setSelectedClassId(classId)} />
          ) : (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderEyebrow}>{activeTab.toUpperCase()}</Text>
              <Text style={styles.placeholderTitle}>{activeTab} is ready for the next feature.</Text>
              <Text style={styles.placeholderBody}>The navigation and local-first client foundation are in place.</Text>
            </View>
          )}
        </ScrollView>
        <NavigationBar activeTab={activeTab} onSelect={setActiveTab} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.page },
  app: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 15, backgroundColor: theme.colors.white, borderBottomWidth: 1, borderBottomColor: theme.colors.line, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { color: theme.colors.ink, fontSize: 20, fontWeight: '800' },
  breadcrumb: { color: theme.colors.muted, fontSize: 11, marginTop: 4 },
  breadcrumbStrong: { color: theme.colors.ink, fontWeight: '700' },
  serverIndicator: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: theme.colors.greenSoft, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9 },
  pulse: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.green },
  serverText: { color: theme.colors.green, fontSize: 10, fontWeight: '700' },
  content: { padding: 18, paddingBottom: 28 },
  placeholder: { backgroundColor: theme.colors.white, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.line, padding: 24, marginTop: 20 },
  placeholderEyebrow: { color: theme.colors.violet, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  placeholderTitle: { color: theme.colors.ink, fontSize: 22, fontWeight: '800', marginTop: 10 },
  placeholderBody: { color: theme.colors.muted, fontSize: 13, lineHeight: 20, marginTop: 10 },
  databaseMessage: { alignItems: 'center', paddingVertical: 40 },
  databaseMessageText: { color: theme.colors.muted, fontSize: 12, marginTop: 10, textAlign: 'center' },
  databaseError: { color: '#c45f69', fontSize: 15, fontWeight: '800' },
});
