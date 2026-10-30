import { collection, limit, onSnapshot, orderBy, query, type Unsubscribe } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseDb, getFirebaseFunctions } from './app';
import type { ServiceController, ServiceControllerCommand, ServiceControllerLog, ServiceCommandRecord } from '../types/serviceMonitor';
import { mapServiceController, mapServiceLog, mapServiceCommand, SERVICE_LOG_LIMIT, SERVICE_COMMAND_LIMIT } from '../serviceMonitorData';

export function listenServiceControllers(onData: (controllers: ServiceController[]) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(collection(getFirebaseDb(), 'serviceControllers'), snapshot => {
    onData(snapshot.docs.map(item => mapServiceController(item.id, item.data())).sort((a, b) => a.name.localeCompare(b.name, 'ru')));
  }, onError);
}
export function listenServiceControllerLogs(controllerId: string, onData: (logs: ServiceControllerLog[]) => void, onError: (error: Error) => void): Unsubscribe {
  const entries = query(collection(getFirebaseDb(), 'serviceControllerLogs', controllerId, 'entries'), orderBy('receivedAt', 'desc'), limit(SERVICE_LOG_LIMIT));
  return onSnapshot(entries, snapshot => onData(snapshot.docs.map(item => mapServiceLog(item.id, item.data())).filter((item): item is ServiceControllerLog => item !== null)), onError);
}
export function listenServiceControllerCommands(controllerId: string, onData: (commands: ServiceCommandRecord[]) => void, onError: (error: Error) => void): Unsubscribe {
  const entries = query(collection(getFirebaseDb(), 'serviceControllerCommands', controllerId, 'commands'), orderBy('requestedAt', 'desc'), limit(SERVICE_COMMAND_LIMIT));
  return onSnapshot(entries, snapshot => onData(snapshot.docs.map(item => mapServiceCommand(item.id, item.data())).filter((item): item is ServiceCommandRecord => item !== null)), onError);
}
export async function queueServiceControllerCommand(controllerId: string, command: ServiceControllerCommand): Promise<{ commandId: string }> {
  const queueCommand = httpsCallable<{ controllerId: string; command: ServiceControllerCommand }, { commandId: string }>(getFirebaseFunctions(), 'queueServiceControllerCommand');
  const result = await queueCommand({ controllerId, command });
  return result.data;
}
