import {useState} from 'react';
import {Text, TextInput, Pressable, Panel, Heading, Caption} from './WorkspaceUI';
import {LocalServerClient} from '../services/serverApi';

export function TeacherClassTools({classId, onSaved, onMessage}: {classId: string; onSaved: () => Promise<void>; onMessage: (message: string) => void}) {
  const [eventTitle, setEventTitle] = useState(''); const [date, setDate] = useState(''); const [time, setTime] = useState('09:00');
  return <Panel><Heading>Add a class event</Heading><Caption>Share a reminder with the selected class. Classes are created and managed by administrators.</Caption><TextInput placeholder="Event title" value={eventTitle} onChangeText={setEventTitle}/><TextInput placeholder="Date (YYYY-MM-DD)" value={date} onChangeText={setDate}/><TextInput placeholder="Time (HH:MM)" value={time} onChangeText={setTime}/><Pressable disabled={!classId || !eventTitle.trim()} onPress={async () => {try {
    const starts = new Date(`${date}T${time}:00`); if(Number.isNaN(starts.getTime())) throw Error('Enter a valid date and time.');
    await new LocalServerClient().mutate('/api/calendar/events', {classId, title: eventTitle, startsAt: starts.toISOString(), eventType: 'class'});
    setEventTitle(''); onMessage('Calendar event queued for sync.'); void onSaved();
  } catch(e){onMessage(String(e));}}}><Text>Save class event</Text></Pressable></Panel>;
}
