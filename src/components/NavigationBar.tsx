import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

const tabs = [['Dashboard', '⌂'], ['Calendar', '□'], ['Assignments', '▤'], ['Classes', '♙'], ['Developer', '⚙']];

export function NavigationBar({ activeTab, onSelect }: { activeTab: string; onSelect: (tab: string) => void }) {
  return <View style={styles.bar}>{tabs.map(([label, icon]) => <Pressable key={label} style={styles.item} onPress={() => onSelect(label)}><Text style={[styles.icon, activeTab === label && styles.active]}>{icon}</Text><Text style={[styles.label, activeTab === label && styles.active]}>{label}</Text></Pressable>)}</View>;
}

const styles = StyleSheet.create({ bar: { flexDirection: 'row', backgroundColor: theme.colors.white, borderTopWidth: 1, borderTopColor: theme.colors.line, paddingTop: 8, paddingBottom: 6 }, item: { flex: 1, alignItems: 'center', gap: 3 }, icon: { color: theme.colors.muted, fontSize: 18 }, label: { color: theme.colors.muted, fontSize: 9, fontWeight: '700' }, active: { color: theme.colors.violet } });
