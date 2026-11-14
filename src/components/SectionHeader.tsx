import { Pressable, StyleSheet, Text, View } from 'react-native';
import { faArrowRight } from '@fortawesome/free-solid-svg-icons';
import { AppIcon } from './AppIcon';
import { theme } from '../theme';

export function SectionHeader({ eyebrow, title, action, onAction }: { eyebrow: string; title: string; action?: string; onAction?: () => void }) {
  return <View style={styles.row}><View><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.title}>{title}</Text></View>{action ? <Pressable accessibilityRole="button" onPress={onAction} style={styles.action}><Text style={styles.actionText}>{action}</Text><AppIcon icon={faArrowRight} size={10} color={theme.colors.violet} /></Pressable> : null}</View>;
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 17 }, eyebrow: { color: '#a0a9bb', fontSize: 9, fontWeight: '800', letterSpacing: 1.1 }, title: { color: theme.colors.ink, fontSize: 18, fontWeight: '800', marginTop: 6 }, action: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }, actionText: { color: theme.colors.violet, fontSize: 11, fontWeight: '800' } });
