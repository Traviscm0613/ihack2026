import { Pressable, StyleSheet, Text, View } from 'react-native';
import { faArrowLeft, faBookOpen } from '@fortawesome/free-solid-svg-icons';
import { AppIcon } from '../components/AppIcon';
import { ClassMaterial } from '../db/database';
import { theme } from '../theme';

export function MaterialViewerScreen({ material, onBack }: { material: ClassMaterial; onBack: () => void }) {
  return <View><Pressable style={styles.back} onPress={onBack}><AppIcon icon={faArrowLeft} size={12} color={theme.colors.violet} /><Text style={styles.backText}>Back to class</Text></Pressable><View style={styles.header}><AppIcon icon={faBookOpen} size={18} color={theme.colors.violet} /><View><Text style={styles.type}>{material.type}</Text><Text style={styles.title}>{material.title}</Text></View></View><View style={styles.paper}><Text style={styles.content}>{material.content || 'This material does not have readable text yet.'}</Text>{material.uri ? <Text style={styles.uri}>Attached file: {material.uri}</Text> : null}</View></View>;
}

const styles = StyleSheet.create({ back: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 22 }, backText: { color: theme.colors.violet, fontSize: 12, fontWeight: '800' }, header: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.colors.violetSoft, borderRadius: 13, padding: 17 }, type: { color: theme.colors.violet, fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 }, title: { color: theme.colors.ink, fontSize: 23, fontWeight: '800', marginTop: 5 }, paper: { backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 13, padding: 20, marginTop: 15 }, content: { color: theme.colors.ink, fontSize: 14, lineHeight: 24 }, uri: { color: theme.colors.muted, fontSize: 10, marginTop: 20 } });
