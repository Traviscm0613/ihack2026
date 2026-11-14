import {useEffect, useState} from 'react';
import {View, Platform, Switch} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {Text, TextInput, Pressable, Panel, Heading, Caption} from './WorkspaceUI';
import {LocalServerClient} from '../services/serverApi';
import {cacheValue, cachedValue, createAssignment, createQuiz, saveMaterialLocally, type SchoolClass} from '../db/database';
import type {SubmissionType} from '../data/mockData';

type Question = {id: string; type: 'multiple_choice' | 'short_answer' | 'true_false'; prompt: string; options: string[]; correctAnswer: string; points: number};
type Attachment = {id: string; uri: string; name: string; type: string};
const id = () => `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const question = (): Question => ({id: id(), type: 'multiple_choice', prompt: '', options: ['', ''], correctAnswer: '', points: 1});
const empty = () => ({mode: 'assignment' as 'assignment' | 'quiz' | 'material', title: '', description: '', date: '', time: '23:59', types: ['file', 'photo', 'scan'] as SubmissionType[], allowLate: true, allowResubmission: false, questions: [question()], files: [] as Attachment[]});

export function TeacherComposer({schoolClass, onSaved, onMessage}: {schoolClass: SchoolClass; onSaved: () => Promise<void>; onMessage: (text: string) => void}) {
  const [draft, setDraft] = useState(empty);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = `composer:${schoolClass.id}`;
  useEffect(() => {let active = true; cachedValue<ReturnType<typeof empty>>(key).then(saved => {if(active){if(saved) setDraft(saved); setReady(true);}}); return () => {active = false;};}, [key]);
  useEffect(() => {if(ready) void cacheValue(key, draft);}, [draft, ready, key]);
  const patch = (value: Partial<typeof draft>) => setDraft(current => ({...current, ...value}));
  const editQuestion = (index: number, update: Partial<Question>) => patch({questions: draft.questions.map((q, i) => i === index ? {...q, ...update} : q)});
  const pick = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({multiple: true, copyToCacheDirectory: true});
      if(result.canceled) return;
      const files: Attachment[] = [];
      for (const asset of result.assets) {
        const fileId = id(); let uri = asset.uri;
        if(Platform.OS === 'web') {
          const blob = await (await fetch(uri)).blob();
          uri = await new Promise<string>((resolve, reject) => {const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(blob);});
        } else {
          const directory = `${FileSystem.documentDirectory}teacher-resources/`;
          await FileSystem.makeDirectoryAsync(directory, {intermediates: true});
          uri = directory + fileId; await FileSystem.copyAsync({from: asset.uri, to: uri});
        }
        files.push({id: fileId, uri, name: asset.name, type: asset.mimeType ?? 'application/octet-stream'});
      }
      patch({files: [...draft.files, ...files]});
    } catch(e){onMessage(String(e));}
  };
  const save = async () => {
    setBusy(true);
    try {
      if(!draft.title.trim()) throw Error('Enter a title.');
      if(draft.mode !== 'material' && (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time))) throw Error('Enter a due date (YYYY-MM-DD) and time (HH:MM).');
      const due = new Date(`${draft.date}T${draft.time}:00`);
      if(draft.mode !== 'material' && Number.isNaN(due.getTime())) throw Error('Enter a valid due date.');
      if(draft.mode === 'assignment' && !draft.types.length) throw Error('Choose at least one submission type.');
      if(draft.mode === 'quiz' && (!draft.questions.length || draft.questions.some(q => !q.prompt.trim() || q.points < 1 || (q.type !== 'short_answer' && (!q.correctAnswer || q.options.some(o => !o.trim()) || !q.options.includes(q.correctAnswer) || new Set(q.options).size !== q.options.length))))) throw Error('Complete each question, use distinct options, and select the correct answer.');
      const entityId = id();
      const questions = draft.questions.map(q => ({...q, type: q.type === 'true_false' ? 'multiple_choice' : q.type}));
      const body = {id: entityId, classId: schoolClass.id, title: draft.title.trim(), description: draft.description, content: draft.description, dueAt: draft.mode === 'material' ? undefined : due.toISOString(), dueDate: draft.date, submissionTypes: draft.types, allowLate: draft.allowLate, allowResubmission: draft.allowResubmission, questions, __files: draft.mode === 'assignment' ? draft.files : []};
      const path = draft.mode === 'assignment' ? '/api/assignments' : draft.mode === 'quiz' ? '/api/quizzes' : '/api/materials';
      await new LocalServerClient().mutate(path, body);
      if(draft.mode === 'assignment') await createAssignment({id: entityId, classId: schoolClass.id, title: body.title, subject: schoolClass.name, teacher: schoolClass.teacher, description: body.description, dueDate: draft.date, due: draft.date, completed: false, tone: 'math', submissionTypes: draft.types, grade: null, feedback: null});
      if(draft.mode === 'quiz') await createQuiz({id: entityId, classId: schoolClass.id, title: body.title, description: body.description, dueDate: draft.date, questions: questions.map(q => ({...q, type: q.type as 'multiple_choice' | 'short_answer'}))});
      if(draft.mode === 'material') await saveMaterialLocally({id: entityId, classId: schoolClass.id, title: body.title, type: 'resource', uri: null, content: draft.description});
      const cleared = empty(); cleared.mode = draft.mode; setDraft(cleared); await cacheValue(key, cleared);
      onMessage('Saved on this device. Publishing will finish automatically when the Pi is reachable.');
      void onSaved();
    } catch(e) {onMessage(e instanceof Error ? e.message : String(e));}
    finally {setBusy(false);}
  };
  return <Panel><Heading>Create for {schoolClass.name}</Heading><Caption>Drafts save automatically, including when you are offline.</Caption>
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>{(['assignment', 'quiz', 'material'] as const).map(mode => <Pressable key={mode} accessibilityState={{selected: draft.mode === mode}} onPress={() => patch({mode})}><Text>{draft.mode === mode ? '✓ ' : ''}{mode[0].toUpperCase() + mode.slice(1)}</Text></Pressable>)}</View>
    <Text>Title</Text><TextInput value={draft.title} onChangeText={title => patch({title})} placeholder={draft.mode === 'quiz' ? 'e.g. Chapter 3 review' : 'Give this work a title'}/>
    <Text>{draft.mode === 'material' ? 'Reading text' : 'Description & instructions'}</Text><TextInput multiline value={draft.description} onChangeText={description => patch({description})} placeholder="Explain what students need to do…"/>
    {draft.mode !== 'material' ? <><Text>Due date · your device’s local time</Text><View style={{flexDirection: 'row', gap: 12}}><TextInput style={{flex: 2}} accessibilityLabel="Due date" placeholder="YYYY-MM-DD" value={draft.date} onChangeText={date => patch({date})}/><TextInput style={{flex: 1}} accessibilityLabel="Due time" placeholder="HH:MM" value={draft.time} onChangeText={time => patch({time})}/></View></> : null}
    {draft.mode === 'assignment' ? <><Text>Accepted submission types</Text><View style={{flexDirection: 'row', gap: 8, flexWrap: 'wrap'}}>{(['file', 'photo', 'scan'] as SubmissionType[]).map(type => <Pressable key={type} onPress={() => patch({types: draft.types.includes(type) ? draft.types.filter(t => t !== type) : [...draft.types, type]})}><Text>{draft.types.includes(type) ? '✓ ' : ''}{type}</Text></Pressable>)}</View>
      <View style={{flexDirection: 'row', justifyContent: 'space-between'}}><Text>Allow late submissions</Text><Switch value={draft.allowLate} onValueChange={allowLate => patch({allowLate})}/></View>
      <View style={{flexDirection: 'row', justifyContent: 'space-between'}}><Text>Allow resubmissions</Text><Switch value={draft.allowResubmission} onValueChange={allowResubmission => patch({allowResubmission})}/></View>
      <Pressable onPress={pick}><Text>+ Attach instructions or reference documents</Text></Pressable>{draft.files.map(f => <View key={f.id}><Text>{f.name}</Text><Pressable onPress={() => patch({files: draft.files.filter(file => file.id !== f.id)})}><Text>Remove attachment</Text></Pressable></View>)}</> : null}
    {draft.mode === 'quiz' ? <>{draft.questions.map((q, index) => <Panel key={q.id}><Heading>Question {index + 1}</Heading><View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>{(['multiple_choice', 'true_false', 'short_answer'] as const).map(type => <Pressable key={type} onPress={() => editQuestion(index, {type, options: type === 'true_false' ? ['True', 'False'] : ['', ''], correctAnswer: ''})}><Text>{type === q.type ? '✓ ' : ''}{type.replace(/_/g, ' ')}</Text></Pressable>)}</View>
      <TextInput placeholder="What would you like to ask?" multiline value={q.prompt} onChangeText={prompt => editQuestion(index, {prompt})}/><Text>Points</Text><TextInput keyboardType="numeric" value={String(q.points)} onChangeText={v => editQuestion(index, {points: Number(v) || 1})}/>
      {q.type !== 'short_answer' ? <><Caption>Enter the choices, then select the correct answer.</Caption>{q.options.map((option, choice) => <View key={choice} style={{gap: 8}}>{q.type === 'multiple_choice' ? <TextInput placeholder={`Choice ${choice + 1}`} value={option} onChangeText={value => editQuestion(index, {options: q.options.map((o, i) => i === choice ? value : o), correctAnswer: q.correctAnswer === option ? value : q.correctAnswer})}/> : <Text>{option}</Text>}<Pressable disabled={!option} onPress={() => editQuestion(index, {correctAnswer: option})}><Text>{option && option === q.correctAnswer ? '✓ Correct answer' : 'Mark as correct'}</Text></Pressable></View>)}{q.type === 'multiple_choice' ? <Pressable onPress={() => editQuestion(index, {options: [...q.options, '']})}><Text>+ Add choice</Text></Pressable> : null}</> : <Caption>Written responses will be graded by you.</Caption>}
      <Pressable onPress={() => patch({questions: draft.questions.filter(item => item.id !== q.id)})}><Text>Remove question</Text></Pressable></Panel>)}<Pressable onPress={() => patch({questions: [...draft.questions, question()]})}><Text>+ Add question</Text></Pressable><Caption>{draft.questions.length} questions · {draft.questions.reduce((sum, q) => sum + q.points, 0)} total points</Caption></> : null}
    <Pressable disabled={!ready || busy} onPress={save}><Text>{busy ? 'Saving…' : `Save & publish ${draft.mode}`}</Text></Pressable>
  </Panel>;
}
