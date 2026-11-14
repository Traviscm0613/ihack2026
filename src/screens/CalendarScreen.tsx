import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { CalendarEvent } from '../db/database';
import { createEvent, deleteEvent, updateEvent } from '../db/database';
import { theme } from '../theme';

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const today = new Date();
const selectableYears = [today.getFullYear(), today.getFullYear() + 1];

function keyFor(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function labelFor(date: Date) { return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }
function inputDateFor(date: Date) { return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`; }
function parseInputDate(value: string) {
  const match = value.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return null;
  const month = months.findIndex((item) => item.toLowerCase() === match[2].toLowerCase());
  const date = new Date(Number(match[3]), month, Number(match[1]));
  return month >= 0 && date.getMonth() === month && date.getDate() === Number(match[1]) ? date : null;
}
function displayTime(value?: string) { return value?.replace(/^0(?=\d:)/, '') ?? '9:00'; }

export function CalendarScreen({ events, onSaved }: { events: CalendarEvent[]; onSaved: () => Promise<void> }) {
  const [viewDate, setViewDate] = useState(new Date(today));
  const [selectedDate, setSelectedDate] = useState(new Date(today));
  const [eventDate, setEventDate] = useState(inputDateFor(today));
  const [time, setTime] = useState('9:00');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const days = useMemo(() => {
    const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const startOffset = (first.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, index) => new Date(viewDate.getFullYear(), viewDate.getMonth(), index - startOffset + 1));
  }, [viewDate]);
  const selectedEvents = events.filter((event) => event.date === keyFor(selectedDate)).sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));

  const chooseDate = (date: Date) => {
    setSelectedDate(date);
    setViewDate(new Date(date.getFullYear(), date.getMonth(), 1));
    setEventDate(inputDateFor(date));
  };
  const moveMonth = (offset: number) => chooseDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + offset, 1));
  const saveEvent = async () => {
    const parsedDate = parseInputDate(eventDate);
    if (!parsedDate || !time || !title.trim() || !notes.trim()) return;
    setSaving(true);
    try {
      const input = { title: title.trim(), date: keyFor(parsedDate), time: displayTime(time), notes: notes.trim(), kind: 'school' as const, localOnly: true };
      if (editingEventId) await updateEvent(editingEventId, input);
      else await createEvent({ id: undefined, ...input });
      const date = parsedDate;
      setSelectedDate(date);
      setViewDate(new Date(date.getFullYear(), date.getMonth(), 1));
      setTitle('');
      setNotes('');
      setTime('9:00');
      setEventDate(inputDateFor(date));
      setEditingEventId(null);
      await onSaved();
    } finally { setSaving(false); }
  };

  const editEvent = (event: CalendarEvent) => {
    const date = new Date(`${event.date}T00:00:00`);
    setSelectedDate(date);
    setViewDate(new Date(date.getFullYear(), date.getMonth(), 1));
    setEventDate(inputDateFor(date));
    setTime(displayTime(event.time));
    setTitle(event.title);
    setNotes(event.notes ?? '');
    setEditingEventId(event.id);
  };
  const removeEvent = () => {
    if (!editingEventId) return;
    Alert.alert('Delete event?', 'This event will be removed from your calendar.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteEvent(editingEventId); setEditingEventId(null); setTitle(''); setNotes(''); setTime('9:00'); setEventDate(inputDateFor(selectedDate)); await onSaved(); } },
    ]);
  };

  return <View>
    <View style={styles.intro}><Text style={styles.kicker}>YOUR SCHEDULE</Text><Text style={styles.title}>Calendar</Text><Text style={styles.subtitle}>Choose any year, month, or day to plan ahead.</Text></View>
    <View style={styles.card}>
      <View style={styles.monthHeader}><View><Text style={styles.kicker}>SELECTED MONTH</Text><Text style={styles.monthTitle}>{months[viewDate.getMonth()]} {viewDate.getFullYear()}</Text></View><View style={styles.monthButtons}><Pressable accessibilityRole="button" accessibilityLabel="Go to today" style={styles.todayButton} onPress={() => chooseDate(today)}><Text style={styles.todayText}>Today</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Previous month" style={styles.arrowButton} onPress={() => moveMonth(-1)}><Text style={styles.arrow}>←</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Next month" style={styles.arrowButton} onPress={() => moveMonth(1)}><Text style={styles.arrow}>→</Text></Pressable></View></View>
      <Text style={styles.controlLabel}>YEAR</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{selectableYears.map((year) => <Pressable key={year} onPress={() => chooseDate(new Date(year, viewDate.getMonth(), 1))} style={[styles.choice, viewDate.getFullYear() === year && styles.choiceActive]}><Text style={[styles.choiceText, viewDate.getFullYear() === year && styles.choiceTextActive]}>{year}</Text></Pressable>)}</ScrollView>
      <Text style={styles.controlLabel}>MONTH</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{months.map((month, index) => <Pressable key={month} onPress={() => chooseDate(new Date(viewDate.getFullYear(), index, 1))} style={[styles.choice, viewDate.getMonth() === index && styles.choiceActive]}><Text style={[styles.choiceText, viewDate.getMonth() === index && styles.choiceTextActive]}>{month.slice(0, 3)}</Text></Pressable>)}</ScrollView>
      <View style={styles.weekdays}>{weekdays.map((day) => <Text key={day} style={styles.weekday}>{day}</Text>)}</View><View style={styles.days}>{days.map((date) => { const inMonth = date.getMonth() === viewDate.getMonth(); const selected = keyFor(date) === keyFor(selectedDate); const hasEvent = events.some((event) => event.date === keyFor(date)); return <Pressable key={keyFor(date)} onPress={() => chooseDate(date)} style={[styles.day, !inMonth && styles.dayMuted, selected && styles.daySelected]}><Text style={[styles.dayText, !inMonth && styles.dayTextMuted, selected && styles.dayTextSelected]}>{date.getDate()}</Text>{hasEvent ? <View style={[styles.dayDot, selected && styles.dayDotSelected]} /> : null}</Pressable>; })}</View>
      <View style={styles.selectedDate}><Text style={styles.selectedDateTitle}>{labelFor(selectedDate)}</Text>{selectedEvents.length ? selectedEvents.map((event) => event.localOnly ? <Pressable key={event.id} onPress={() => editEvent(event)} style={styles.eventRow}><View style={styles.eventDot} /><View><Text style={styles.eventTime}>{displayTime(event.time)} · {event.title}</Text><Text style={styles.eventNotes}>{event.notes || 'Saved locally'}</Text><Text style={styles.editHint}>Tap to edit</Text></View></Pressable> : <View key={event.id} style={styles.eventRow}><View style={styles.eventDot} /><View><Text style={styles.eventTime}>{displayTime(event.time)} · {event.title}</Text><Text style={styles.eventNotes}>{event.notes || 'School calendar event'}</Text><Text style={styles.editHint}>School event · read only</Text></View></View>) : <Text style={styles.empty}>No events planned for this day yet.</Text>}</View>
    </View>
    <View style={styles.card}><Text style={styles.kicker}>{editingEventId ? 'EDIT EVENT' : 'PLAN AHEAD'}</Text><Text style={styles.formTitle}>{editingEventId ? 'Edit event' : 'Add an event'}</Text><Text style={styles.fieldLabel}>TITLE</Text><TextInput value={title} onChangeText={setTitle} placeholder="Event title" placeholderTextColor="#a0a9bb" style={styles.input} /><Text style={styles.fieldLabel}>DATE</Text><TextInput value={eventDate} onChangeText={setEventDate} placeholder="13 November 2026" placeholderTextColor="#a0a9bb" style={styles.input} /><Text style={styles.fieldLabel}>TIME</Text><TextInput value={time} onChangeText={setTime} placeholder="9:00" placeholderTextColor="#a0a9bb" style={styles.input} /><Text style={styles.fieldLabel}>NOTES</Text><TextInput value={notes} onChangeText={setNotes} placeholder="What do you need to remember?" placeholderTextColor="#a0a9bb" multiline style={[styles.input, styles.notesInput]} /><Pressable disabled={saving} onPress={saveEvent} style={[styles.saveButton, saving && styles.saveDisabled]}><Text style={styles.saveText}>{saving ? 'Saving…' : editingEventId ? 'Update event  →' : 'Save event  →'}</Text></Pressable>{editingEventId ? <><Pressable onPress={() => { setEditingEventId(null); setTitle(''); setNotes(''); setTime('9:00'); setEventDate(inputDateFor(selectedDate)); }}><Text style={styles.cancelText}>Cancel editing</Text></Pressable><Pressable onPress={removeEvent} style={styles.deleteButton}><Text style={styles.deleteText}>Delete event</Text></Pressable></> : null}</View>
  </View>;
}

const styles = StyleSheet.create({
  intro: { marginBottom: 17 }, kicker: { color: '#a0a9bb', fontSize: 9, letterSpacing: 1.1, fontWeight: '800' }, title: { color: theme.colors.ink, fontSize: 28, fontWeight: '800', marginTop: 7 }, subtitle: { color: theme.colors.muted, fontSize: 13, marginTop: 5 }, card: { backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 13, padding: 17, marginBottom: 14 }, monthHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }, monthTitle: { color: theme.colors.ink, fontSize: 18, fontWeight: '800', marginTop: 6 }, monthButtons: { flexDirection: 'row', gap: 5 }, todayButton: { height: 29, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#dfdcff', backgroundColor: '#f7f6ff', borderRadius: 6 }, todayText: { color: theme.colors.violet, fontSize: 10, fontWeight: '800' }, arrowButton: { width: 29, height: 29, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.line, borderRadius: 6 }, arrow: { color: theme.colors.muted, fontSize: 21, lineHeight: 23 }, controlLabel: { color: '#a0a9bb', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginTop: 9 }, choiceRow: { gap: 7, paddingVertical: 8 }, choice: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 7 }, choiceActive: { backgroundColor: theme.colors.violet, borderColor: theme.colors.violet }, choiceText: { color: theme.colors.muted, fontSize: 10, fontWeight: '700' }, choiceTextActive: { color: theme.colors.white }, weekdays: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 6, marginBottom: 7 }, weekday: { width: '14.28%', textAlign: 'center', color: '#a7afbd', fontSize: 9 }, days: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 5 }, day: { width: '14.28%', height: 29, alignItems: 'center', justifyContent: 'center', position: 'relative', borderRadius: 7 }, dayMuted: { opacity: 0.45 }, daySelected: { backgroundColor: theme.colors.violet }, dayText: { color: '#66728d', fontSize: 10 }, dayTextMuted: { color: '#c5cbd5' }, dayTextSelected: { color: theme.colors.white, fontWeight: '800' }, dayDot: { position: 'absolute', bottom: 3, width: 4, height: 4, borderRadius: 2, backgroundColor: '#e99b68' }, dayDotSelected: { backgroundColor: theme.colors.white }, selectedDate: { borderTopWidth: 1, borderTopColor: theme.colors.line, marginTop: 15, paddingTop: 14 }, selectedDateTitle: { color: theme.colors.ink, fontSize: 12, fontWeight: '800' }, eventRow: { flexDirection: 'row', gap: 9, marginTop: 11 }, eventDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#e89969', marginTop: 3 }, eventTime: { color: theme.colors.ink, fontSize: 10, fontWeight: '800' }, eventNotes: { color: '#8490a4', fontSize: 9, marginTop: 4 }, editHint: { color: theme.colors.violet, fontSize: 9, marginTop: 4, fontWeight: '700' }, empty: { color: '#9aa4b5', fontSize: 10, marginTop: 10 }, formTitle: { color: theme.colors.ink, fontSize: 18, fontWeight: '800', marginTop: 6, marginBottom: 16 }, fieldLabel: { color: '#9aa4b5', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginTop: 10, marginBottom: 6 }, input: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: 8, color: theme.colors.ink, fontSize: 12, paddingHorizontal: 11, paddingVertical: 10 }, notesInput: { minHeight: 78, textAlignVertical: 'top' }, saveButton: { backgroundColor: theme.colors.ink, borderRadius: 8, alignItems: 'center', paddingVertical: 12, marginTop: 14 }, saveDisabled: { opacity: 0.65 }, saveText: { color: theme.colors.white, fontSize: 11, fontWeight: '800' }, cancelText: { color: theme.colors.muted, fontSize: 11, fontWeight: '700', textAlign: 'center', marginTop: 12 }, deleteButton: { borderWidth: 1, borderColor: '#f0c8cd', borderRadius: 8, alignItems: 'center', paddingVertical: 11, marginTop: 10 }, deleteText: { color: '#c45f69', fontSize: 11, fontWeight: '800' },
});
