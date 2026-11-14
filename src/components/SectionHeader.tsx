import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

export function SectionHeader({ eyebrow, title, action }: { eyebrow: string; title: string; action?: string }) {
  return <View style={styles.row}><View><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.title}>{title}</Text></View>{action ? <Text style={styles.action}>{action}  →</Text> : null}</View>;
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 17 }, eyebrow: { color: '#a0a9bb', fontSize: 9, fontWeight: '800', letterSpacing: 1.1 }, title: { color: theme.colors.ink, fontSize: 18, fontWeight: '800', marginTop: 6 }, action: { color: theme.colors.violet, fontSize: 11, fontWeight: '800', marginTop: 4 } });
