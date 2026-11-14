import { Pressable, StyleSheet, Text, View } from 'react-native';
import { faCalendarDays, faChalkboard, faGears, faHouse, faListCheck } from '@fortawesome/free-solid-svg-icons';
import { AppIcon } from './AppIcon';
import { theme } from '../theme';

const studentTabs = [['Dashboard', faHouse], ['Calendar', faCalendarDays], ['Assignments', faListCheck], ['Classes', faChalkboard], ['Developer', faGears]] as const;
const staffTabs = [['Dashboard', faHouse], ['Calendar', faCalendarDays], ['Classes', faChalkboard], ['Workspace', faGears]] as const;

export function NavigationBar({ activeTab, onSelect, role = 'student' }: { activeTab: string; onSelect: (tab: string) => void; role?: 'student' | 'teacher' | 'administrator' }) {
  const tabs = role === 'student' ? studentTabs : staffTabs;
  return <View style={styles.bar}>{tabs.map(([label, icon]) => <Pressable key={label} style={styles.item} onPress={() => onSelect(label)}><AppIcon icon={icon} size={17} color={activeTab === label ? theme.colors.violet : theme.colors.muted} /><Text style={[styles.label, activeTab === label && styles.active]}>{label}</Text></Pressable>)}</View>;
}

const styles = StyleSheet.create({ bar: { flexDirection: 'row', backgroundColor: theme.colors.white, borderTopWidth: 1, borderTopColor: theme.colors.line, paddingTop: 8, paddingBottom: 6 }, item: { flex: 1, alignItems: 'center', gap: 3 }, label: { color: theme.colors.muted, fontSize: 9, fontWeight: '700' }, active: { color: theme.colors.violet } });
