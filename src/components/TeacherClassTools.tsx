import {useState} from 'react';
import {Text, TextInput, Pressable, Panel, Heading, Caption} from './WorkspaceUI';
import {LocalServerClient} from '../services/serverApi';
import {createClass} from '../db/database';

export function TeacherClassTools({classId, onSaved, onMessage}: {classId: string; onSaved: () => Promise<void>; onMessage: (message: string) => void}) {
  const [sectionName, setSectionName] = useState(''); const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [room, setRoom] = useState('');
  const [eventTitle, setEventTitle] = useState(''); const [date, setDate] = useState(''); const [time, setTime] = useState('09:00');
  return <><Panel><Heading>Create a class</Heading><TextInput placeholder="Class name" value={name} onChangeText={setName}/><TextInput placeholder="Section (optional)" value={sectionName} onChangeText={setSectionName}/><TextInput placeholder="Room or location" value={room} onChangeText={setRoom}/><TextInput placeholder="Class description" multiline value={description} onChangeText={setDescription}/><Pressable disabled={!name.trim()} onPress={async () => {try {
    const id = `class-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await new LocalServerClient().mutate('/api/classes', {id, name, description, room, sectionName: sectionName.trim() || null});
    await createClass({id, name, description, teacher: 'You', sectionName: sectionName.trim() || null, location: room, grade: '', color: 'purple'});
    setName(''); setSectionName(''); setDescription(''); setRoom(''); onMessage('Class saved locally and queued for publication.'); void onSaved();
  } catch(e){onMessage(String(e));}}}><Text>Save new class</Text></Pressable></Panel>
  <Panel><Heading>Class calendar event</Heading><Caption>Share a reminder or event with the selected class.</Caption><TextInput placeholder="Event title" value={eventTitle} onChangeText={setEventTitle}/><TextInput placeholder="Date (YYYY-MM-DD)" value={date} onChangeText={setDate}/><TextInput placeholder="Time (HH:MM)" value={time} onChangeText={setTime}/><Pressable disabled={!classId || !eventTitle.trim()} onPress={async () => {try {
    const starts = new Date(`${date}T${time}:00`); if(Number.isNaN(starts.getTime())) throw Error('Enter a valid date and time.');
    await new LocalServerClient().mutate('/api/calendar/events', {classId, title: eventTitle, startsAt: starts.toISOString(), eventType: 'class'});
    setEventTitle(''); onMessage('Calendar event queued for sync.'); void onSaved();
  } catch(e){onMessage(String(e));}}}><Text>Save class event</Text></Pressable></Panel></>;
}
