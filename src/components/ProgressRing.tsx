import {createThemedStyles} from '../theme';
import Svg, { Circle } from 'react-native-svg';
import { Text, View } from 'react-native';
import { theme } from '../theme';

export function ProgressRing({ completed, total, color, size = 76, strokeWidth = 7, showCount = true }: { completed: number; total: number; color: string; size?: number; strokeWidth?: number; showCount?: boolean }) {
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  return <View style={[styles.ring, { width: size, height: size }]}><Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}><Circle cx={size / 2} cy={size / 2} r={radius} stroke="#e9edf3" strokeWidth={strokeWidth} fill="none" /><Circle cx={size / 2} cy={size / 2} r={radius} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={circumference - (percent / 100) * circumference} rotation="-90" origin={`${size / 2}, ${size / 2}`} /></Svg><View style={styles.label}><Text style={[styles.percent, size >= 110 && styles.largePercent]}>{percent}%</Text>{showCount ? <Text style={styles.count}>{completed}/{total}</Text> : null}</View></View>;
}

const styles = createThemedStyles({ ring: { alignItems: 'center', justifyContent: 'center' }, label: { position: 'absolute', alignItems: 'center', justifyContent: 'center' }, percent: { color: theme.colors.ink, fontSize: 13, fontWeight: '800' }, largePercent: { fontSize: 23 }, count: { color: theme.colors.muted, fontSize: 9, fontWeight: '700', marginTop: 2 } });
