import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { listenServiceControllerCommands, listenServiceControllerLogs, listenServiceControllers, queueServiceControllerCommand } from '../../shared/firebase/serviceMonitor';
import type { ServiceController, ServiceControllerCommand, ServiceControllerLog, ServiceCommandRecord } from '../../shared/types/serviceMonitor';
import type { SourceStatus } from '../../shared/context/dataReadiness';
import { serviceCanCommand, type ServiceFeed } from './serviceMonitorLogic';
import { ServiceMonitorWorkspace } from './ServiceMonitorWorkspace';
import type { ServiceCommandFeedback } from './ServiceControllerPanels';

type Subscribe<T> = (id: string, data: (items: T[]) => void, error: (error: Error) => void) => () => void;
function useControllerFeed<T>(id: string | null, refresh: number, enabled: boolean, subscribe: Subscribe<T>): ServiceFeed<T> {
  const [feed, setFeed] = useState<ServiceFeed<T>>({ controllerId: null, data: [], status: 'loading', error: '' });
  useEffect(() => {
    if (!id || !enabled) { setFeed({ controllerId: id, data: [], status: 'loading', error: '' }); return; }
    let active = true;
    setFeed({ controllerId: id, data: [], status: 'loading', error: '' });
    const fail = (error: Error) => { if (active) setFeed({ controllerId: id, data: [], status: 'error', error: error.message }); };
    let unsubscribe: (() => void) | undefined;
    try { unsubscribe = subscribe(id, data => { if (active) setFeed({ controllerId: id, data, status: 'ready', error: '' }); }, fail); }
    catch (error) { fail(error instanceof Error ? error : new Error('Не удалось подключиться')); }
    return () => { active = false; unsubscribe?.(); };
  }, [id, refresh, enabled, subscribe]);
  return feed;
}

export function ServiceMonitorTab() {
  const { myProfile, isOwner } = useAuth();
  const role = isOwner ? 'owner' : myProfile?.role ?? 'mechanic';
  const manager = ['owner', 'admin', 'manager'].includes(role);
  const [registry, setRegistry] = useState<{ data: ServiceController[]; status: SourceStatus }>({ data: [], status: 'loading' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [nowMs, setNowMs] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<ServiceCommandFeedback | null>(null);
  const commandLock = useRef(false);
  const mounted = useRef(true);
  const selected = registry.status === 'ready' ? registry.data.find(c => c.id === selectedId) ?? registry.data[0] ?? null : null;
  const id = selected?.id ?? null;
  const logs = useControllerFeed<ServiceControllerLog>(id, refresh, true, listenServiceControllerLogs);
  const commands = useControllerFeed<ServiceCommandRecord>(id, refresh, manager, listenServiceControllerCommands);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const fail = () => { if (active) setRegistry({ data: [], status: 'error' }); };
    try { unsubscribe = listenServiceControllers(data => {
      if (!active) return;
      setRegistry({ data, status: 'ready' });
      setSelectedId(previous => data.some(c => c.id === previous) ? previous : data[0]?.id ?? null);
    }, fail); } catch { fail(); }
    return () => { active = false; unsubscribe?.(); };
  }, [refresh]);
  useEffect(() => { const timer = window.setInterval(() => setNowMs(Date.now()), 15000); return () => window.clearInterval(timer); }, []);

  function retry() { setRegistry({ data: [], status: 'loading' }); setRefresh(value => value + 1); }
  async function sendCommand(command: ServiceControllerCommand) {
    if (!selected || !serviceCanCommand(role, selected) || commandLock.current) return;
    const targetId = selected.id;
    commandLock.current = true; setBusy(true); setFeedback(null);
    try {
      const result = await queueServiceControllerCommand(targetId, command);
      if (mounted.current) setFeedback({ controllerId: targetId, command, state: 'queued', message: `Запрос поставлен в очередь. Выполнение подтвердится в истории запросов. Номер: ${result.commandId}` });
    } catch {
      if (mounted.current) setFeedback({ controllerId: targetId, command, state: 'error', message: 'Не удалось подтвердить постановку запроса в очередь. Проверьте подключение и историю запросов перед повторной отправкой.' });
    } finally { commandLock.current = false; if (mounted.current) setBusy(false); }
  }
  return <ServiceMonitorWorkspace controllers={registry.data} status={registry.status} selectedId={id} nowMs={nowMs} role={role} logs={logs} commands={commands} commandBusy={busy} feedback={feedback} onSelect={setSelectedId} onRetry={retry} onCommand={command => void sendCommand(command)}/>;
}
