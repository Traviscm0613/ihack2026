import {useState} from 'react';
import {Platform, Linking} from 'react-native';
import {Pressable, Text, Caption} from './WorkspaceUI';
import {LocalServerClient} from '../services/serverApi';

export function FileAttachments({files}: {files: {id: string; name: string}[]}) {
  const [message, setMessage] = useState('');
  return <>{files.map(file => <Pressable key={file.id} onPress={async () => {
    try {
      const client = new LocalServerClient();
      if(Platform.OS === 'web') {
        const blob = await client.file(file.id);
        const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else await Linking.openURL(await client.downloadFile(file.id, file.name));
      setMessage('');
    } catch {setMessage('This file has not been downloaded yet. Reconnect to the school Wi-Fi to save it for offline use.');}
  }}><Text>↓ {file.name}</Text></Pressable>)}{message ? <Caption>{message}</Caption> : null}</>;
}
