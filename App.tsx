import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Dashboard } from './src/screens/Dashboard';
import { NavigationBar } from './src/components/NavigationBar';
import { theme } from './src/theme';
import { assignments } from './src/data/mockData';

export default function App() {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [query, setQuery] = useState('');
  const filteredAssignments = useMemo(
    () => assignments.filter((item) => item.title.toLowerCase().includes(query.toLowerCase())),
    [query],
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
          {activeTab === 'Dashboard' ? (
            <Dashboard assignments={filteredAssignments} query={query} onQueryChange={setQuery} />
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
});
