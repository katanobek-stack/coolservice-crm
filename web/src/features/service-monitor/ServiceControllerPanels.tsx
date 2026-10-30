import { useState } from 'react';
import type { ServiceController, ServiceControllerCommand, ServiceControllerLog, ServiceCommandRecord, ServiceLogLevel } from '../../shared/types/serviceMonitor';
import { SERVICE_COMMANDS, SERVICE_COMMAND_LIMIT, SERVICE_LOG_LIMIT } from '../../shared/serviceMonitorData';
import { Input } from '../../shared/ui/Input';
import { COMMAND_LABELS, COMMAND_STATUS_LABELS, SERVICE_STATE_LABELS, filterServiceLogs, scopedServiceFeed, serviceBytes, serviceCanCommand, serviceContact, serviceDateTime, serviceHealth, serviceLogText, serviceRelative, serviceUptime, type ServiceFeed } from './serviceMonitorLogic';

export interface ServiceCommandFeedback { controllerId: string; command: ServiceControllerCommand; state: 'queued' | 'error'; message: string }

export function ServiceDiagnostics({ controller, nowMs }: { controller: ServiceController; nowMs: number }) {
  const health = serviceHealth(controller, nowMs);
  const boolean = (value: boolean | null) => value === null ? 'Нет данных' : value ? 'Подключено' : 'Нет подключения';
  const facts = [
    ['Прошивка', controller.firmwareVersion ?? 'Нет данных'], ['Время работы', serviceUptime(controller.uptimeSeconds)],
    ['Свободная память', serviceBytes(controller.freeHeapBytes)], ['IP-адрес', controller.ip ?? 'Нет данных'],
    ['Последний heartbeat', serviceDateTime(controller.lastHeartbeatAt)], ['Последний MQTT-статус', serviceDateTime(controller.lastStatusAt)],
    ['Последняя перезагрузка', controller.resetReason ?? 'Нет данных'], ['Flash', serviceBytes(controller.flashBytes)], ['PSRAM', serviceBytes(controller.psramBytes)],
  ];
  return <section className="svc-panel svc-diagnostics" aria-label={`Диагностика ${controller.name}`}>
    <header className="svc-panel-heading"><div><span className="svc-eyebrow">Диагностика контроллера</span><h2>{controller.name}</h2><p>{controller.objectName}</p></div><span className={`svc-status is-${health.state}`}>{SERVICE_STATE_LABELS[health.state]}</span></header>
    <div className="svc-device-id"><i className="ti ti-cpu" aria-hidden="true"/><span>{controller.deviceId}</span><span>ESP32 / SIM800L</span></div>
    <div className={`svc-connection-note is-${health.state}`}><strong>{serviceRelative(serviceContact(controller), nowMs)}</strong><p>{health.explanation}</p></div>
    {health.state !== 'online' && <p className="svc-muted-note">Ниже — последние сохранённые параметры. Они могут отличаться от текущего состояния устройства.</p>}
    <div className="svc-diagnostic-grid">
      <div className={controller.simSignal !== null && controller.simSignal < 10 ? 'is-warning' : ''}><span>Сигнал SIM</span><strong>{controller.simSignal === null ? 'Нет данных' : `${controller.simSignal} / 31`}</strong><div className="svc-signal" aria-hidden="true">{[1, 2, 3, 4, 5].map(bar => <i key={bar} style={{ height: 4 + bar * 3 }} className={controller.simSignal !== null && controller.simSignal >= bar * 6 - 5 ? 'is-filled' : ''}/>)}</div><small>{controller.simSignal === null ? 'Уровень ещё не получен' : controller.simSignal < 10 ? 'Слабый сигнал' : controller.simSignal < 20 ? 'Средний сигнал' : 'Хороший сигнал'}</small></div>
      <div><span>Мобильный интернет</span><strong>{boolean(controller.gprsConnected)}</strong><small>GPRS</small></div>
      <div><span>Связь с модемом</span><strong>{boolean(controller.uartConnected)}</strong><small>UART</small></div>
      <div><span>Состояние модема</span><strong>{controller.modemState}</strong><small>Последний полученный статус</small></div>
    </div>
    {health.issues.length > 0 && <ul className="svc-issues">{health.issues.map(issue => <li key={issue}><i className="ti ti-alert-circle" aria-hidden="true"/>{issue}</li>)}</ul>}
    <details className="svc-technical"><summary>Технические параметры <span>Владивосток · UTC+10</span></summary><dl>{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>
  </section>;
}

export function ServiceCommandPanel({ controller, role, nowMs, busy, feedback, history: source, onCommand, onRetry }: {
  controller: ServiceController; role: string; nowMs: number; busy: boolean; feedback: ServiceCommandFeedback | null; history: ServiceFeed<ServiceCommandRecord>; onCommand(command: ServiceControllerCommand): void; onRetry(): void;
}) {
  const manager = ['owner', 'admin', 'manager'].includes(role);
  if (!manager) return <section className="svc-panel svc-role-note"><i className="ti ti-lock" aria-hidden="true"/><p>Диагностические команды и их история доступны менеджеру, администратору и владельцу. Просмотр параметров и журнала доступен всем сотрудникам.</p></section>;
  const history = scopedServiceFeed(source, controller.id);
  return <section className="svc-panel svc-commands" aria-label="Диагностические команды">
    <header className="svc-panel-heading"><div><h2>Проверить устройство</h2><p>Запросы диагностики без перезагрузки и изменения настроек.</p></div><i className="ti ti-terminal-2" aria-hidden="true"/></header>
    {!controller.enabled ? <p className="svc-inline-note">Контроллер отключён в реестре. Отправка запросов недоступна.</p> : serviceHealth(controller, nowMs).state !== 'online' && <p className="svc-inline-note">Контроллер сейчас не на связи. Запрос останется в очереди до восстановления связи.</p>}
    <div className="svc-command-grid">{SERVICE_COMMANDS.map(command => <button type="button" disabled={busy || !serviceCanCommand(role, controller)} key={command} onClick={() => onCommand(command)}><i className={`ti ${command === 'SERVICE PING' ? 'ti-broadcast' : command === 'SERVICE STATUS' ? 'ti-activity' : 'ti-info-circle'}`} aria-hidden="true"/><strong>{COMMAND_LABELS[command].title}</strong><span>{COMMAND_LABELS[command].description}</span><code>{command}</code></button>)}</div>
    {busy && <p className="svc-muted-note" role="status">Отправляем диагностический запрос…</p>}
    {feedback?.controllerId === controller.id && <div className={`svc-feedback is-${feedback.state}`} role={feedback.state === 'error' ? 'alert' : 'status'}><strong>{COMMAND_LABELS[feedback.command].title}</strong><p>{feedback.message}</p></div>}
    <div className="svc-history-heading"><h3>История запросов</h3><span>Последние {SERVICE_COMMAND_LIMIT}</span></div>
    <p className="svc-muted-note">«В очереди» и «Ожидает ответа» ещё не означают выполнение. Результат подтверждается ответом контроллера.</p>
    {history.status === 'error' ? <div className="svc-source-message is-error" role="alert"><strong>Не удалось загрузить историю запросов</strong><p>Проверьте историю перед повторной отправкой.</p><button type="button" onClick={onRetry}>Повторить подключение</button></div> : history.status === 'loading' ? <div className="svc-source-message" role="status">Загружаем историю запросов…</div> : !history.data.length ? <div className="svc-source-message">Запросов для этого контроллера пока нет.</div> : <ol className="svc-command-history">{history.data.map(command => <li key={command.id}><details><summary><span><strong>{COMMAND_LABELS[command.command].title}</strong><small>{serviceDateTime(command.requestedAt)}</small></span><b className={`svc-command-status is-${command.status}`}>{COMMAND_STATUS_LABELS[command.status]}</b></summary><div className="svc-command-result"><code>{command.command} · {command.id}</code>{command.resultMessage && <p>{command.resultMessage}</p>}{command.completedAt && <small>Ответ получен: {serviceDateTime(command.completedAt)}</small>}{['queued', 'claimed', 'dispatched'].includes(command.status) && command.requestedAt && nowMs - command.requestedAt.getTime() > 120000 && <p>Ответ ещё не получен. Проверьте связь и работу моста перед повторным запросом.</p>}</div></details></li>)}</ol>}
  </section>;
}

export function ServiceLogPanel({ controller, feed: source, onRetry }: { controller: ServiceController; feed: ServiceFeed<ServiceControllerLog>; onRetry(): void }) {
  const feed = scopedServiceFeed(source, controller.id);
  const [level, setLevel] = useState<ServiceLogLevel | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [frozen, setFrozen] = useState<ServiceControllerLog[] | null>(null);
  const ready = feed.status === 'ready';
  const logs = ready ? frozen ?? feed.data : [];
  const visible = filterServiceLogs(logs, level, search);
  const unseen = frozen ? feed.data.filter(log => !frozen.some(old => old.id === log.id)).length : 0;
  function download() {
    if (!ready || !visible.length) return;
    const blob = new Blob(['\uFEFF' + serviceLogText(controller, visible)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `service-${controller.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.txt`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="svc-panel svc-logs" aria-label="Журнал контроллера">
    <header className="svc-panel-heading"><div><h2>Журнал событий</h2><p>Последние {SERVICE_LOG_LIMIT} полученных строк · Владивосток, UTC+10</p></div><span className={`svc-live-indicator ${frozen ? 'is-paused' : ''}`}>{frozen ? 'Пауза' : ready ? 'Прямой эфир' : 'Нет подключения'}</span></header>
    <div className="svc-log-tools"><label>Поиск в журнале<Input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Сообщение или код ошибки"/></label><div className="svc-log-actions"><button type="button" disabled={!ready} aria-pressed={frozen !== null} onClick={() => setFrozen(frozen ? null : [...feed.data])}>{frozen ? 'Продолжить' : 'Пауза'}</button><button type="button" disabled={!ready || !visible.length} onClick={download}><i className="ti ti-download" aria-hidden="true"/> Скачать TXT</button></div></div>
    <div className="svc-log-filter-row"><div role="group" aria-label="Уровень события">{(['ALL', 'ERROR', 'WARN', 'INFO'] as const).map(value => <button type="button" key={value} aria-pressed={level === value} onClick={() => setLevel(value)}>{value === 'ALL' ? 'Все' : value === 'ERROR' ? 'Ошибки' : value === 'WARN' ? 'Предупреждения' : 'Информация'}</button>)}</div><span aria-live="polite">{ready ? `Показано: ${visible.length}` : 'Ожидаем данные'}</span></div>
    {frozen && ready && <p className="svc-inline-note">Просмотр приостановлен. Новых строк в текущей выборке: {unseen}. При скачивании сохранится показанный снимок журнала.</p>}
    {feed.status === 'error' ? <div className="svc-source-message is-error" role="alert"><strong>Не удалось загрузить журнал</strong><p>Записи недоступны. Повторите подключение.</p><button type="button" onClick={onRetry}>Повторить подключение</button></div> : !ready ? <div className="svc-source-message" role="status">Загружаем журнал контроллера…</div> : <div className="svc-log-window" tabIndex={0} role="region" aria-label="Строки журнала">{visible.length ? visible.map(log => <div className={`svc-log-line is-${log.level.toLowerCase()}`} key={log.id}><time>{serviceDateTime(log.receivedAt ?? log.reportedAt)}</time><strong>{log.level}</strong><code>{log.message}</code></div>) : <div className="svc-log-empty">{logs.length ? 'Нет строк по выбранным условиям. Измените поиск или уровень события.' : 'Журнал пока пуст. Здесь появятся полученные события контроллера.'}</div>}</div>}
  </section>;
}
