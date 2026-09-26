import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import {
  listenServiceControllerLogs,
  listenServiceControllers,
  queueServiceControllerCommand,
} from "../../shared/firebase/serviceMonitor";
import type { ServiceController, ServiceControllerCommand, ServiceControllerLog, ServiceLogLevel } from "../../shared/types/serviceMonitor";
import { isServiceControllerOnline, SERVICE_MONITOR_OFFLINE_MINUTES } from "../../shared/serviceMonitorStatus";
import "./serviceMonitor.css";

type LogFilter = "ALL" | ServiceLogLevel;

function localDateTime(value: Date | null): string {
  return value ? value.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Нет данных";
}

function relativeTime(value: Date | null, nowMs: number): string {
  if (!value) return "Нет данных";
  const seconds = Math.max(0, Math.floor((nowMs - value.getTime()) / 1_000));
  if (seconds < 30) return "только что";
  if (seconds < 60) return `${seconds} сек. назад`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин. назад`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} ч. назад` : `${Math.floor(hours / 24)} дн. назад`;
}

function formatBytes(value: number | null): string {
  if (value === null) return "Нет данных";
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
  return `${(value / (1024 * 1024)).toFixed(1)} МБ`;
}

function formatUptime(value: number | null): string {
  if (value === null) return "Нет данных";
  const days = Math.floor(value / 86_400);
  const hours = Math.floor((value % 86_400) / 3_600);
  const minutes = Math.floor((value % 3_600) / 60);
  return `${days ? `${days} д ` : ""}${hours} ч ${minutes} мин`;
}

function ControllerList({ controllers, selectedId, nowMs, onSelect }: {
  controllers: ServiceController[]; selectedId: string | null; nowMs: number; onSelect: (id: string) => void;
}) {
  if (controllers.length === 0) return <div className="service-monitor-empty">Контроллеры ещё не зарегистрированы. Реестр создаётся доверенным администратором.</div>;
  return <div className="service-controller-list">{controllers.map((controller) => {
    const online = isServiceControllerOnline(controller.enabled, controller.lastHeartbeatAt, nowMs);
    return <button key={controller.id} type="button" className={`service-controller-card ${selectedId === controller.id ? "is-selected" : ""}`} onClick={() => onSelect(controller.id)}>
      <div className="service-controller-card-head"><span className={`service-status-dot ${online ? "is-online" : "is-offline"}`} /><strong>{controller.name}</strong><span className={`service-status ${online ? "is-online" : "is-offline"}`}>{online ? "Онлайн" : "Оффлайн"}</span></div>
      <span>{controller.objectName}</span>
      <small>ID: {controller.deviceId}</small>
      <div className="service-controller-meta"><span><i className="ti ti-clock" /> {relativeTime(controller.lastHeartbeatAt, nowMs)}</span><span><i className="ti ti-antenna-bars-5" /> {controller.simSignal === null ? "—" : `${controller.simSignal}/31`}</span></div>
      <div className="service-controller-meta"><span><i className="ti ti-device-mobile" /> {controller.modemState}</span><span><i className="ti ti-world" /> {controller.gprsConnected ? "GPRS" : "Нет GPRS"}</span></div>
    </button>;
  })}</div>;
}

function ControllerDetails({ controller, nowMs, onCommand, canCommand, commandBusy, commandMessage }: {
  controller: ServiceController; nowMs: number; onCommand: (command: ServiceControllerCommand) => void; canCommand: boolean; commandBusy: boolean; commandMessage: string;
}) {
  const online = isServiceControllerOnline(controller.enabled, controller.lastHeartbeatAt, nowMs);
  const facts = [
    ["Версия прошивки", controller.firmwareVersion ?? "Нет данных", "ti ti-code"],
    ["Uptime", formatUptime(controller.uptimeSeconds), "ti ti-clock-hour-4"],
    ["Свободная Heap", formatBytes(controller.freeHeapBytes), "ti ti-brand-stackoverflow"],
    ["Flash", formatBytes(controller.flashBytes), "ti ti-device-sd-card"],
    ["PSRAM", formatBytes(controller.psramBytes), "ti ti-memory"],
    ["Последняя перезагрузка", controller.resetReason ?? "Нет данных", "ti ti-refresh-alert"],
    ["Последний heartbeat", localDateTime(controller.lastHeartbeatAt), "ti ti-heartbeat"],
    ["UART-связь", controller.uartConnected === null ? "Нет данных" : controller.uartConnected ? "Подключена" : "Нет связи", "ti ti-plug-connected"],
  ];
  return <>
    <section className="crm-section service-main-card">
      <div className="section-header"><div><div className="section-title">Основной ESP32</div><div className="service-subtitle">{controller.objectName} · {controller.deviceId}</div></div><span className={`service-status ${online ? "is-online" : "is-offline"}`}>{online ? "На связи" : "Связь потеряна"}</span></div>
      <div className="service-connection-row"><span><i className="ti ti-network" /> IP: {controller.ip ?? "Нет данных"}</span><span><i className="ti ti-antenna-bars-5" /> SIM800L: {controller.simSignal === null ? "Нет данных" : `${controller.simSignal} / 31`}</span><span><i className="ti ti-world" /> {controller.gprsConnected ? "GPRS подключён" : "GPRS не подключён"}</span><span><i className="ti ti-cpu" /> Модем: {controller.modemState}</span></div>
      <div className="service-facts">{facts.map(([label, value, icon]) => <div key={label}><i className={icon} /><span>{label}</span><strong>{value}</strong></div>)}</div>
    </section>
    <section className="crm-section service-commands">
      <div className="section-header"><div><div className="section-title">Команды</div><div className="service-subtitle">Только безопасный whitelist. Команда ставится в очередь и не исполняет AT-код из браузера.</div></div></div>
      <div className="service-command-row">{(["SERVICE PING", "SERVICE STATUS", "SERVICE INFO"] as ServiceControllerCommand[]).map((command) => <button key={command} type="button" className="btn-primary" disabled={commandBusy || !canCommand} title={canCommand ? undefined : "Команды доступны manager, admin и owner"} onClick={() => onCommand(command)}>{commandBusy ? "Отправляем…" : command}</button>)}</div>
      <div className="service-command-row service-command-row--blocked"><button type="button" disabled><i className="ti ti-lock" /> RESET</button><button type="button" disabled><i className="ti ti-lock" /> GPIO0</button><span>Будет доступно после проверки bootloader.</span></div>
      {commandMessage && <div className="service-command-message" role="status">{commandMessage}</div>}
    </section>
  </>;
}

function LiveLog({ logs, filter, onFilter }: { logs: ServiceControllerLog[]; filter: LogFilter; onFilter: (filter: LogFilter) => void }) {
  const visible = filter === "ALL" ? logs : logs.filter((log) => log.level === filter);
  return <section className="crm-section service-live-log"><div className="section-header"><div><div className="section-title">Live-лог</div><div className="service-subtitle">Обновляется автоматически; новые строки появляются сверху.</div></div><div className="service-log-filters">{(["ALL", "ERROR", "WARN", "INFO"] as LogFilter[]).map((value) => <button key={value} type="button" className={filter === value ? "is-active" : ""} onClick={() => onFilter(value)}>{value === "ALL" ? "Все" : value}</button>)}</div></div>
    <div className="service-log-window" aria-live="polite">{visible.length === 0 ? <div className="service-log-empty">Строк лога для выбранного фильтра пока нет.</div> : visible.map((log) => <div key={log.id} className={`service-log-line service-log-line--${log.level.toLowerCase()}`}><time>{localDateTime(log.reportedAt ?? log.receivedAt)}</time><strong>{log.level}</strong><code>TARGET &lt;&lt; {log.message}</code></div>)}</div>
  </section>;
}

export function ServiceMonitorTab() {
  const { myProfile } = useAuth();
  const [controllers, setControllers] = useState<ServiceController[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<ServiceControllerLog[]>([]);
  const [filter, setFilter] = useState<LogFilter>("ALL");
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandMessage, setCommandMessage] = useState("");
  const role = myProfile?.role ?? "mechanic";
  const canCommand = role === "owner" || role === "admin" || role === "manager";

  useEffect(() => {
    const unsubscribe = listenServiceControllers((next) => {
      setControllers(next);
      setSelectedId((current) => next.some((item) => item.id === current) ? current : (next[0]?.id ?? null));
    }, (nextError) => setError(nextError.message || "Не удалось загрузить контроллеры"));
    return unsubscribe;
  }, [refresh]);
  useEffect(() => { const timer = window.setInterval(() => setNowMs(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!selectedId) { setLogs([]); return undefined; }
    return listenServiceControllerLogs(selectedId, setLogs, (nextError) => setError(nextError.message || "Не удалось загрузить лог"));
  }, [selectedId, refresh]);

  const selected = useMemo(() => controllers.find((item) => item.id === selectedId) ?? null, [controllers, selectedId]);
  async function sendCommand(command: ServiceControllerCommand) {
    if (!selected || !canCommand) return;
    setCommandBusy(true); setCommandMessage("");
    try { const result = await queueServiceControllerCommand(selected.id, command); setCommandMessage(`${command} поставлена в очередь (${result.commandId}).`); }
    catch (nextError) { setCommandMessage(nextError instanceof Error ? nextError.message : "Не удалось поставить команду в очередь."); }
    finally { setCommandBusy(false); }
  }

  return <div className="service-monitor-page">
    <div className="service-monitor-title"><div><h2>Сервисный монитор</h2><p>Диагностика сервисных контроллеров отдельно от температурного мониторинга.</p></div><button type="button" className="btn-ghost" onClick={() => { setError(""); setRefresh((value) => value + 1); }}><i className="ti ti-refresh" /> Обновить данные</button></div>
    {error && <div className="service-monitor-error"><i className="ti ti-alert-triangle" /> {error}</div>}
    <section className="crm-section service-controller-section"><div className="section-header"><div className="section-title">Сервисные контроллеры</div><span className="service-subtitle">Онлайн определяется по heartbeat за {SERVICE_MONITOR_OFFLINE_MINUTES} минут.</span></div><ControllerList controllers={controllers} selectedId={selectedId} nowMs={nowMs} onSelect={setSelectedId} /></section>
    {selected ? <><ControllerDetails controller={selected} nowMs={nowMs} onCommand={sendCommand} canCommand={canCommand} commandBusy={commandBusy} commandMessage={commandMessage} />{canCommand ? null : <div className="service-role-note"><i className="ti ti-lock" /> Команды доступны менеджеру, администратору и владельцу. Просмотр доступен всем рабочим ролям.</div>}<LiveLog logs={logs} filter={filter} onFilter={setFilter} /></> : null}
  </div>;
}
