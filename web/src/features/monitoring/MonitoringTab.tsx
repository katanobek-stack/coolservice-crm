import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useAuth } from "../auth";
import { useData } from "../../shared/context/DataContext";
import {
  DEFAULT_OFFLINE_THRESHOLD_MINUTES,
  deleteMonitoringTemperatureRule,
  listenDeviceHistory,
  listenMonitoringDevices,
  listenMonitoringDeviceSensors,
  listenMonitoringControllerStatuses,
  listenMonitoringSettings,
  listenMonitoringSensorStates,
  listenMonitoringStates,
  listenMonitoringTemperatureRules,
  renameMonitoringDevice,
  saveMonitoringTemperatureRule,
  saveMonitoringSensorName,
  saveOfflineThreshold,
} from "../../shared/firebase/monitoring";
import {
  downsampleTemperaturePoints,
  temperatureChartSegments,
  monitoringPeriodMs,
  chartXAxisTicks,
  panChartWindow,
  resizeChartWindow,
  zoomChartWindow,
  objectLabel,
  sensorDisplayName,
  temperatureRuleTargetsSensor,
  type ChartWindow,
  type ConnectionStatus,
  type ReadingStatus,
} from "../../shared/monitoring/logic";
import type {
  MonitoringDevice,
  MonitoringDeviceState,
  MonitoringSensor,
  MonitoringSensorState,
  MonitoringControllerStatus,
  MonitoringHistoryResult,
  MonitoringPeriod,
  MonitoringTemperatureRule,
  TemperaturePoint,
} from "../../shared/types/monitoring";
import "./monitoring.css";
import {MonitoringOverview,MonitoringSourceBoundary} from "./MonitoringOverview";
import {DEFAULT_MONITOR_FILTERS,monitorRows,monitorSourcesReady,monitorReading,safeMonitorTemperature,selectedSensorViews,monitorSensorColor,type MonitorSources,type MonitorSource} from "./workspaceLogic";
import "./monitoring-workspace.css";

const EMPTY_HISTORY: MonitoringHistoryResult = {
  points: [],
  packetCount: 0,
  limitReached: false,
};

function formatTemperature(value: number | undefined): string {
  if (safeMonitorTemperature(value) === undefined) return "—";
  return `${value!.toFixed(1)} °C`;
}

function formatDateTime(value: Date | null | undefined): string {
  if (!value || !Number.isFinite(value.getTime())) return "Нет данных";
  return value.toLocaleString("ru-RU", {
    timeZone: "Asia/Vladivostok",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function relativeTime(value: Date | null | undefined, nowMs: number): string {
  if (!value || !Number.isFinite(value.getTime())) return "Нет данных";
  const seconds = Math.max(0, Math.floor((nowMs - value.getTime()) / 1_000));
  if (seconds < 30) return "только что";
  if (seconds < 60) return `${seconds} сек. назад`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин. назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч. назад`;
  return `${Math.floor(hours / 24)} дн. назад`;
}

function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days} дн. ${hours} ч`;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  if (minutes > 0) return `${minutes} мин ${seconds} сек`;
  return `${seconds} сек`;
}

function ReadingBadge({ status }: { status: ReadingStatus }) {
  const labels: Record<ReadingStatus, string> = {
    fresh: "Показание актуально",
    stale: "Показание устарело",
    missing: "Нет измерений",
  };
  return <span className={`monitor-badge monitor-badge--reading-${status}`}>{labels[status]}</span>;
}

function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const labels: Record<ConnectionStatus, string> = {
    online: "На связи",
    offline: "Связь потеряна",
    unknown: "Статус связи не получен",
  };
  return <span className={`monitor-badge monitor-badge--connection-${status}`}>{labels[status]}</span>;
}

function registrationLabel(status: MonitoringControllerStatus): string {
  const labels: Record<MonitoringControllerStatus["registrationState"], string> = {
    home: "Домашняя сеть", roaming: "Роуминг", searching: "Поиск сети",
    denied: "Регистрация отклонена", unknown: "Неизвестно",
  };
  return `${status.networkRegistered ? "Зарегистрирован" : "Не зарегистрирован"} · ${labels[status.registrationState]}`;
}

function failureLabel(code: MonitoringControllerStatus["lastFailureCode"]): string {
  const labels: Record<MonitoringControllerStatus["lastFailureCode"], string> = {
    none: "Нет", modem_not_ready: "Модем не готов", network_not_registered: "Нет регистрации в сети",
    ntp_sync_failed: "Не удалось синхронизировать время", gprs_connect_failed: "Не удалось подключить GPRS",
    tcp_connect_failed: "Не удалось подключить TCP", mqtt_connect_failed: "Не удалось подключить MQTT",
    publish_send_failed: "Не удалось отправить публикацию", puback_timeout: "Тайм-аут подтверждения MQTT",
    modem_restarted: "Модем перезапущен", esp_restarted: "ESP32 перезапущен",
  };
  return labels[code];
}

function DiagnosticsPanel({ status, connection, nowMs }: {
  status: MonitoringControllerStatus | undefined;
  connection: ConnectionStatus;
  nowMs: number;
}) {
  if (!status) return <section className="crm-section monitor-diagnostics"><div className="section-header"><div className="section-title">Связь и диагностика</div><ConnectionBadge status={connection} /></div><div className="monitor-rules-empty">Контроллер ещё не передал статус связи и диагностики.</div></section>;
  return (
    <section className="crm-section monitor-diagnostics">
      <div className="section-header"><div><div className="section-title">Связь и диагностика</div><div className="monitor-history-subtitle">Статус контроллера, отдельно от температуры</div></div><ConnectionBadge status={connection} /></div>
      <div className="monitor-diagnostics-grid">
        <div><span>GSM-сигнал</span><strong>{status.rssi === null ? "Нет данных" : `${status.rssi} / 31`}</strong></div>
        <div><span>Регистрация сети</span><strong>{registrationLabel(status)}</strong></div>
        <div><span>GPRS</span><strong>{status.gprsConnected ? "Подключён" : "Нет подключения"}</strong></div>
        <div><span>MQTT</span><strong>{status.mqttConnected ? "Подключён" : "Нет подключения"}</strong></div>
        <div><span>Очередь точек</span><strong>{status.queueDepth}</strong></div>
        <div><span>Время работы</span><strong>{formatUptime(status.uptimeSeconds)}</strong></div>
        <div><span>Последняя ошибка</span><strong>{failureLabel(status.lastFailureCode)}</strong></div>
        <div><span>Последний статус</span><strong>{relativeTime(status.reportedAt, nowMs)}</strong><small>{formatDateTime(status.reportedAt)}</small></div>
        <div><span>Получен сервером</span><strong>{formatDateTime(status.receivedAt)}</strong><small>ID: {status.statusId}</small></div>
      </div>
    </section>
  );
}

function ActiveAlertBadge({ count }: { count: number }) {
  return <span className="monitor-badge monitor-badge--alert-active">Активных аварий: {count}</span>;
}

function RenameMonitoringDeviceDialog({ device, saving, error, blocked=false, onClose, onSave }: {
  device: MonitoringDevice;
  saving: boolean;
  blocked?: boolean;
  error: string;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(device.name);
  return <div className="monitor-rename-backdrop" role="presentation" onMouseDown={onClose}>
    <form className="monitor-rename-dialog" role="dialog" aria-modal="true" aria-labelledby="monitor-rename-title"
      onMouseDown={(event) => event.stopPropagation()}
      onSubmit={(event) => { event.preventDefault(); if(!blocked&&!saving)onSave(name); }}>
      <div className="monitor-rename-dialog-head"><div><h3 id="monitor-rename-title">Название контроллера</h3><p>ID: {device.id}</p></div><button type="button" className="monitor-rename-close" onClick={onClose} aria-label="Закрыть"><i className="ti ti-x" /></button></div>
      <label className="monitor-rename-field"><span>Название</span><input autoFocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Например, Контроллер камеры №1" /></label>
      {blocked&&<div className="monitor-rename-error" role="alert">Источники недоступны. Введённое название сохранено; запись временно недоступна.</div>}
      {error && <div className="monitor-rename-error" role="alert">{error}</div>}
      <div className="monitor-rename-actions"><button type="button" className="monitor-filter-button" disabled={saving} onClick={onClose}>Отмена</button><button type="submit" className="btn btn-primary" disabled={blocked || saving || !name.trim()}>{saving ? "Сохраняем…" : "Сохранить"}</button></div>
    </form>
  </div>;
}

function periodLabel(period: MonitoringPeriod): string {
  if (period === "hour") return "1 час";
  if (period === "halfDay") return "12 часов";
  if (period === "day") return "24 часа";
  if (period === "threeDays") return "3 дня";
  if (period === "week") return "7 дней";
  return "30 дней";
}

function SensorNameEditor({ deviceId, sensor, displayName, canManage }: {
  deviceId: string;
  sensor: MonitoringSensor | undefined;
  displayName: string;
  canManage: boolean;
}) {
  const [value, setValue] = useState(sensor?.name ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setValue(sensor?.name ?? ""), [sensor?.name, sensor?.sensorId]);
  async function save() {
    setSaving(true); setError("");
    try { await saveMonitoringSensorName(deviceId, sensor?.sensorId ?? "", value); setEditing(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить название"); }
    finally { setSaving(false); }
  }
  if (!canManage) return <strong>{displayName}</strong>;
  if (!editing) return <><strong>{displayName}</strong><button type="button" className="monitor-sensor-edit" onClick={() => setEditing(true)}><i className="ti ti-pencil" /> Переименовать</button></>;
  return <div className="monitor-sensor-name-form"><input value={value} maxLength={80} placeholder={displayName} onChange={(event) => setValue(event.target.value)} disabled={saving} aria-label={`Название ${sensor?.sensorId ?? "датчика"}`} /><button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>{saving ? "…" : "Сохранить"}</button><button type="button" disabled={saving} onClick={() => { setValue(sensor?.name ?? ""); setEditing(false); setError(""); }}>Отмена</button>{error && <span>{error}</span>}</div>;
}

const DELAYED_DELIVERY_MESSAGE = "Точка измерена при отсутствии подтверждённой MQTT-связи и доставлена позже";

function qualityDetails(point: TemperaturePoint): string[] {
  const details: string[] = [];
  if (point.timeQuality === "estimated") details.push("Время оценочное — восстановлено после отсутствия UTC");
  if (point.deliveryQuality === "delayed") details.push(DELAYED_DELIVERY_MESSAGE);
  return details;
}

export function chartAxisLabel(timestamp: number, spanMs: number): string {
  const date = new Date(timestamp);
  return spanMs > 24 * 60 * 60_000
    ? date.toLocaleString("ru-RU", { timeZone: "Asia/Vladivostok", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : date.toLocaleTimeString("ru-RU", { timeZone: "Asia/Vladivostok", hour: "2-digit", minute: "2-digit" });
}

type NavigatorDrag = { mode: "pan" | "start" | "end"; originX: number; window: ChartWindow };

function TemperatureChart({ points, period, rules }: {
  points: TemperaturePoint[];
  period: MonitoringPeriod;
  rules: MonitoringTemperatureRule[];
}) {
  const [selectedPointMs, setSelectedPointMs] = useState<number | null>(null);
  const [zoom, setZoom] = useState<ChartWindow | null>(null);
  const [navigatorDrag, setNavigatorDrag] = useState<NavigatorDrag | null>(null);
  const chartScrollRef = useRef<HTMLDivElement>(null);
  const [baseEndMs, setBaseEndMs] = useState(() => Date.now());
  useEffect(() => {
    setBaseEndMs(Date.now());
    setZoom(null);
    setSelectedPointMs(null);
  }, [period]);
  useEffect(() => {
    const element = chartScrollRef.current;
    if (!element) return undefined;
    // React attaches onWheel as a passive listener, so preventDefault there does
    // not stop the page from scrolling while zooming; use a native listener.
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const end = baseEndMs;
      const start = end - monitoringPeriodMs(period);
      const rect = element.getBoundingClientRect();
      const focusFraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const factor = event.deltaY < 0 ? 0.75 : 1.33;
      setZoom((current) => zoomChartWindow(current ?? { start, end }, start, end, focusFraction, factor));
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [baseEndMs, period]);
  const sorted = useMemo(
    () => [...points].sort((left, right) => left.measuredAt.getTime() - right.measuredAt.getTime()),
    [points],
  );
  if (sorted.length === 0) {
    return (
      <div className="monitor-empty monitor-empty--chart">
        <i className="ti ti-chart-line-off" />
        <strong>За этот период измерений нет</strong>
        <span>График появится после приёма пакетов от устройства.</span>
      </div>
    );
  }

  const width = 900;
  const height = 320;
  const padding = { top: 24, right: 22, bottom: 42, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const nowMs = baseEndMs;
  const startMs = nowMs - monitoringPeriodMs(period);
  const baseWindow = { start: startMs, end: nowMs };
  const visibleWindow = zoom ?? baseWindow;
  const visibleStart = visibleWindow.start;
  const visibleEnd = visibleWindow.end;
  const visiblePoints = sorted.filter((point) => point.measuredAt.getTime() >= visibleStart && point.measuredAt.getTime() <= visibleEnd);
  const rendered = downsampleTemperaturePoints(visiblePoints);
  const segments = temperatureChartSegments(rendered);
  const navigatorPoints = downsampleTemperaturePoints(sorted, 180);
  const navigatorSegments = temperatureChartSegments(navigatorPoints);
  const temperatures = visiblePoints.map((point) => point.temperatureC);
  const enabledRules = rules.filter((rule) => rule.enabled);
  const scaleTemperatures = [
    ...visiblePoints.map((point) => point.temperatureC),
    ...enabledRules.map((rule) => rule.thresholdC),
  ];
  const rawMin = Math.min(...temperatures);
  const rawMax = Math.max(...temperatures);
  const scaleMin = Math.min(...scaleTemperatures);
  const scaleMax = Math.max(...scaleTemperatures);
  const spread = Math.max(scaleMax - scaleMin, 1);
  const min = scaleMin - spread * 0.12;
  const max = scaleMax + spread * 0.12;

  const x = (date: Date) => padding.left + ((date.getTime() - visibleStart) / (visibleEnd - visibleStart)) * chartWidth;
  const y = (temperature: number) => padding.top
    + ((max - temperature) / (max - min)) * chartHeight;
  const yTicks = Array.from({ length: 5 }, (_, index) => min + ((max - min) * index) / 4);
  const xTicks = chartXAxisTicks(visibleWindow);
  const average = temperatures.length > 0
    ? temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length
    : NaN;
  const hasTimedTemperatures = temperatures.length > 0;
  const estimatedCount = visiblePoints.filter((point) => point.timeQuality === "estimated").length;
  const delayedCount = visiblePoints.filter((point) => point.deliveryQuality === "delayed").length;
  const selectedPoint = selectedPointMs === null
    ? null
    : rendered.find((point) => point.measuredAt.getTime() === selectedPointMs) ?? null;
  const navigator = { width: 900, height: 82, left: 20, right: 20, top: 10, bottom: 16 };
  const navigatorWidth = navigator.width - navigator.left - navigator.right;
  const navigatorHeight = navigator.height - navigator.top - navigator.bottom;
  const navigatorTemperatures = navigatorPoints.map((point) => point.temperatureC);
  const navigatorMin = Math.min(...navigatorTemperatures);
  const navigatorMax = Math.max(...navigatorTemperatures);
  const navigatorSpread = Math.max(navigatorMax - navigatorMin, 1);
  const navigatorY = (temperature: number) => navigator.top
    + ((navigatorMax + navigatorSpread * 0.08 - temperature) / (navigatorSpread * 1.16)) * navigatorHeight;
  const navigatorX = (timestamp: number) => navigator.left
    + ((timestamp - startMs) / (nowMs - startMs)) * navigatorWidth;
  const selectionX = navigatorX(visibleStart);
  const selectionWidth = Math.max(2, navigatorX(visibleEnd) - selectionX);

  function pointerToTime(clientX: number, element: SVGSVGElement): number {
    const rect = element.getBoundingClientRect();
    const scale = navigatorWidth / navigator.width;
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left - rect.width * navigator.left / navigator.width) / (rect.width * scale)));
    return startMs + fraction * (nowMs - startMs);
  }

  function beginNavigatorDrag(mode: NavigatorDrag["mode"], event: ReactPointerEvent<SVGRectElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setNavigatorDrag({ mode, originX: event.clientX, window: visibleWindow });
  }

  function moveNavigator(event: ReactPointerEvent<SVGSVGElement>) {
    if (!navigatorDrag) return;
    const nextTime = pointerToTime(event.clientX, event.currentTarget);
    const originTime = pointerToTime(navigatorDrag.originX, event.currentTarget);
    const next = navigatorDrag.mode === "pan"
      ? panChartWindow(navigatorDrag.window, startMs, nowMs, nextTime - originTime)
      : resizeChartWindow(navigatorDrag.window, navigatorDrag.mode, nextTime, startMs, nowMs);
    setZoom(next);
  }
  return (
    <>
      <div className="monitor-chart-stats">
        <div><span>Минимум</span><strong>{hasTimedTemperatures ? `${rawMin.toFixed(1)} °C` : "—"}</strong></div>
        <div><span>Средняя</span><strong>{hasTimedTemperatures ? `${average.toFixed(1)} °C` : "—"}</strong></div>
        <div><span>Максимум</span><strong>{hasTimedTemperatures ? `${rawMax.toFixed(1)} °C` : "—"}</strong></div>
        <div><span>Получено за период</span><strong>{visiblePoints.length}</strong></div>
        <div><span>Оценочное время</span><strong>{estimatedCount}</strong></div>
        <div><span>Доставлено позже</span><strong>{delayedCount}</strong></div>
      </div>
      {rendered.length < visiblePoints.length && (
        <div className="monitor-history-subtitle">На графике показано {rendered.length} из {visiblePoints.length} точек</div>
      )}
      {zoom && <button type="button" className="monitor-chart-reset" onClick={() => setZoom(null)}>Сбросить масштаб</button>}
      <div className="monitor-chart-scroll" aria-label="График температуры" ref={chartScrollRef}>
        <svg className="monitor-chart" viewBox={`0 0 ${width} ${height}`} role="img">
          <title>Температура за {periodLabel(period)}</title>
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y(tick)}
                y2={y(tick)}
                className="monitor-chart-grid"
              />
              <text x={padding.left - 10} y={y(tick) + 4} textAnchor="end" className="monitor-chart-label">
                {tick.toFixed(1)}°
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <text
              key={tick}
              x={x(new Date(tick))}
              y={height - 14}
              textAnchor="middle"
              className="monitor-chart-label"
            >
              {chartAxisLabel(tick, visibleEnd - visibleStart)}
            </text>
          ))}
          {enabledRules.map((rule) => (
            <g key={rule.id}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y(rule.thresholdC)}
                y2={y(rule.thresholdC)}
                className={`monitor-chart-limit monitor-chart-limit--${rule.direction}`}
              />
              <text x={width - padding.right} y={y(rule.thresholdC) - 7} textAnchor="end" className={`monitor-chart-limit-label monitor-chart-limit-label--${rule.direction}`}>
                {rule.name}: {rule.direction === "above" ? "выше" : "ниже"} {rule.thresholdC.toFixed(1)} °C
              </text>
            </g>
          ))}
          {segments.map((segment) => (
            <path
              key={`${segment.from.measuredAt.getTime()}-${segment.to.measuredAt.getTime()}`}
              d={`M ${x(segment.from.measuredAt).toFixed(2)} ${y(segment.from.temperatureC).toFixed(2)} L ${x(segment.to.measuredAt).toFixed(2)} ${y(segment.to.temperatureC).toFixed(2)}`}
              className={`monitor-chart-line monitor-chart-line--${segment.timeQuality} monitor-chart-line--${segment.deliveryQuality}`}
            />
          ))}
          {rendered.map((point) => {
            const pointMs = point.measuredAt.getTime();
            const details = qualityDetails(point);
            return (
              <circle
                key={pointMs}
                cx={x(point.measuredAt)}
                cy={y(point.temperatureC)}
                r={selectedPointMs === pointMs ? 5 : 3.2}
                className={`monitor-chart-point monitor-chart-point--${point.timeQuality} monitor-chart-point--${point.deliveryQuality}`}
                role="button"
                tabIndex={0}
                aria-label={[formatDateTime(point.measuredAt), `${point.temperatureC.toFixed(2)} °C`, ...details].join(", ")}
                onClick={() => setSelectedPointMs(pointMs)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") setSelectedPointMs(pointMs);
                }}
              >
                <title>{[formatDateTime(point.measuredAt), `${point.temperatureC.toFixed(2)} °C`, ...details].join(" · ")}</title>
              </circle>
            );
          })}
        </svg>
      </div>
      <div className="monitor-navigator" aria-label="Навигатор графика">
        <svg
          className="monitor-navigator-chart"
          viewBox={`0 0 ${navigator.width} ${navigator.height}`}
          role="slider"
          aria-label="Окно видимого периода"
          aria-valuetext={`${chartAxisLabel(visibleStart, nowMs - startMs)} — ${chartAxisLabel(visibleEnd, nowMs - startMs)}`}
          onPointerMove={moveNavigator}
          onPointerUp={() => setNavigatorDrag(null)}
          onPointerCancel={() => setNavigatorDrag(null)}
        >
          <rect className="monitor-navigator-background" x={navigator.left} y={navigator.top} width={navigatorWidth} height={navigatorHeight} />
          {navigatorSegments.map((segment) => (
            <path
              key={`navigator-${segment.from.measuredAt.getTime()}-${segment.to.measuredAt.getTime()}`}
              d={`M ${navigatorX(segment.from.measuredAt.getTime()).toFixed(2)} ${navigatorY(segment.from.temperatureC).toFixed(2)} L ${navigatorX(segment.to.measuredAt.getTime()).toFixed(2)} ${navigatorY(segment.to.temperatureC).toFixed(2)}`}
              className={`monitor-navigator-line monitor-navigator-line--${segment.timeQuality} monitor-navigator-line--${segment.deliveryQuality}`}
            />
          ))}
          <rect className="monitor-navigator-shade" x={navigator.left} y={navigator.top} width={Math.max(0, selectionX - navigator.left)} height={navigatorHeight} />
          <rect className="monitor-navigator-shade" x={selectionX + selectionWidth} y={navigator.top} width={Math.max(0, navigator.left + navigatorWidth - selectionX - selectionWidth)} height={navigatorHeight} />
          <rect
            className="monitor-navigator-window"
            x={selectionX}
            y={navigator.top}
            width={selectionWidth}
            height={navigatorHeight}
            onPointerDown={(event) => beginNavigatorDrag("pan", event)}
          />
          <rect
            className="monitor-navigator-handle"
            x={selectionX - 6}
            y={navigator.top}
            width={12}
            height={navigatorHeight}
            onPointerDown={(event) => beginNavigatorDrag("start", event)}
          />
          <rect
            className="monitor-navigator-handle"
            x={selectionX + selectionWidth - 6}
            y={navigator.top}
            width={12}
            height={navigatorHeight}
            onPointerDown={(event) => beginNavigatorDrag("end", event)}
          />
        </svg>
      </div>
      {selectedPoint && (
        <div className="monitor-point-detail" role="status">
          <strong>{selectedPoint.temperatureC.toFixed(2)} °C</strong>
          <span>{formatDateTime(selectedPoint.measuredAt)}</span>
          {qualityDetails(selectedPoint).map((detail) => <span key={detail}>{detail}</span>)}
        </div>
      )}
      <div className="monitor-chart-legend">
        <span><i className="monitor-legend-line" /> Точка доставлена при подтверждённой MQTT-связи</span>
        <span><i className="monitor-legend-line monitor-legend-line--delayed" /> {DELAYED_DELIVERY_MESSAGE}</span>
        <span><i className="monitor-legend-line monitor-legend-line--estimated" /> Пунктир: время оценочное — восстановлено после отсутствия UTC</span>
        <span>Линия лишь соединяет соседние измерения и не означает наличие данных между ними</span>
        {enabledRules.length > 0 && <span><i className="monitor-legend-limit" /> Пороги включённых правил</span>}
      </div>
    </>
  );
}

function SensorHistoryChart({
  sensorName,
  sensorId,
  history,
  loading,
  error,
  period,
  rules,
}: {
  sensorName: string;
  sensorId: string;
  history: MonitoringHistoryResult;
  loading: boolean;
  error?: string;
  period: MonitoringPeriod;
  rules: MonitoringTemperatureRule[];
}) {
  return (
    <section className="crm-section monitor-sensor-history" style={{"--monitor-sensor-color":monitorSensorColor(sensorId)} as CSSProperties}>
      <div className="section-header monitor-history-header">
        <div>
          <div className="section-title">{sensorName}</div>
          <div className="monitor-history-subtitle">Отдельный график датчика · ID: {sensorId}</div>
        </div>
      </div>
      <div className="monitor-chart-body">
        {loading ? <div className="monitor-loading"><i className="ti ti-loader-2" /> Загружаем историю…</div>
          : error ? <div className="monitor-error"><i className="ti ti-alert-triangle" /><div><strong>История недоступна</strong><span>{error}</span></div></div>
          : <>
            {history.limitReached && <div className="monitor-limit-warning">Показана не вся история за период — достигнут лимит выборки.</div>}
            <TemperatureChart points={history.points} period={period} rules={rules.filter((rule) => temperatureRuleTargetsSensor(rule, sensorId))} />
          </>}
      </div>
    </section>
  );
}

function TemperatureRulesPanel({ deviceId, sensors, rules, loading, error, canManage }: {
  deviceId: string;
  sensors: Array<{ sensorId: string; name: string }>;
  rules: MonitoringTemperatureRule[];
  loading: boolean;
  error: string;
  canManage: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ruleId, setRuleId] = useState("");
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [threshold, setThreshold] = useState("-15");
  const [sensorId, setSensorId] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  function resetForm() {
    setSensorId(sensors[0]?.sensorId ?? "");
    setEditingId(null);
    setRuleId(`rule-${Date.now().toString(36)}`);
    setName("");
    setEnabled(true);
    setDirection("above");
    setThreshold("-15");
    setMessage("");
  }

  function edit(rule: MonitoringTemperatureRule) {
    setSensorId(rule.sensorId ?? (sensors.find((sensor) => sensor.sensorId === "temperature-1")?.sensorId ?? "default"));
    setEditingId(rule.id);
    setRuleId(rule.id);
    setName(rule.name);
    setEnabled(rule.enabled);
    setDirection(rule.direction);
    setThreshold(String(rule.thresholdC));
    setMessage("");
  }

  async function save() {
    const thresholdC = Number(threshold);
    if (!sensorId || !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(ruleId) || !name.trim() || !Number.isFinite(thresholdC)) {
      setMessage("Выберите датчик и проверьте название и числовой порог правила.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await saveMonitoringTemperatureRule(deviceId, {
        id: ruleId,
        sensorId,
        name: name.trim(),
        enabled,
        direction,
        thresholdC,
      });
      setMessage("Правило сохранено");
      setEditingId(null);
      setRuleId("");
    } catch (nextError) {
      setMessage(nextError instanceof Error ? nextError.message : "Не удалось сохранить правило");
    } finally {
      setSaving(false);
    }
  }

  async function remove(rule: MonitoringTemperatureRule) {
    if (!window.confirm(`Удалить правило «${rule.name}»? Его история сохранится.`)) return;
    setSaving(true);
    setMessage("");
    try {
      await deleteMonitoringTemperatureRule(deviceId, rule.id);
      if (editingId === rule.id) setEditingId(null);
    } catch (nextError) {
      setMessage(nextError instanceof Error ? nextError.message : "Не удалось удалить правило");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="crm-section monitor-alert-settings">
      <div className="section-header">
        <div>
          <div className="section-title">Правила температурных аварий</div>
          <div className="monitor-history-subtitle">Правила работают одновременно; равенство порогу не считается аварией</div>
        </div>
        {canManage && !loading && !error && (
          <button type="button" className="btn-primary" onClick={resetForm} disabled={saving}>
            <i className="ti ti-plus" /> Добавить правило
          </button>
        )}
      </div>
      {loading ? (
        <div className="monitor-loading">Загружаем правила…</div>
      ) : error ? (
        <div className="monitor-settings-message">{error}</div>
      ) : rules.length === 0 ? (
        <div className="monitor-rules-empty">Правила ещё не созданы. Температурный контроль выключен.</div>
      ) : (
        <div className="monitor-rule-list">
          {rules.map((rule) => (
            <article className="monitor-rule-card" key={rule.id}>
              <div>
                <strong>{rule.name}</strong>
                <span>ID: {rule.id} · версия {rule.revision}</span>
                <span>Датчик: {sensors.find((sensor) => sensor.sensorId === rule.sensorId)?.name ?? rule.sensorId ?? "Первый датчик (старое правило)"}</span>
              </div>
              <div className="monitor-rule-threshold">
                {rule.direction === "above" ? "Выше" : "Ниже"} {rule.thresholdC.toFixed(1)} °C
              </div>
              <span className={`monitor-badge ${rule.enabled ? "monitor-badge--reading-fresh" : "monitor-badge--disabled"}`}>
                {rule.enabled ? "Включено" : "Выключено"}
              </span>
              {canManage && (
                <div className="monitor-rule-actions">
                  <button type="button" onClick={() => edit(rule)}>Изменить</button>
                  <button type="button" className="danger" onClick={() => void remove(rule)}>Удалить</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {canManage && (editingId !== null || ruleId !== "") && (
        <div className="monitor-rule-form">
          <label><span>Датчик</span><select value={sensorId} disabled={saving} onChange={(event) => setSensorId(event.target.value)}><option value="">Выберите датчик</option>{sensorId && !sensors.some((sensor) => sensor.sensorId === sensorId) && <option value={sensorId}>{sensorId}</option>}{sensors.map((sensor) => <option key={sensor.sensorId} value={sensor.sensorId}>{sensor.name} · {sensor.sensorId}</option>)}</select></label>
          <label><span>ID правила</span><input value={ruleId} disabled={editingId !== null || saving} onChange={(event) => setRuleId(event.target.value.toLowerCase())} /></label>
          <label><span>Название</span><input value={name} disabled={saving} onChange={(event) => setName(event.target.value)} /></label>
          <label><span>Направление</span><select value={direction} disabled={saving} onChange={(event) => setDirection(event.target.value as "above" | "below")}><option value="above">Выше порога</option><option value="below">Ниже порога</option></select></label>
          <label><span>Порог, °C</span><input type="number" min="-55" max="125" step="0.1" value={threshold} disabled={saving} onChange={(event) => setThreshold(event.target.value)} /></label>
          <label className="monitor-alert-toggle"><input type="checkbox" checked={enabled} disabled={saving} onChange={(event) => setEnabled(event.target.checked)} /><span>{enabled ? "Правило включено" : "Правило выключено"}</span></label>
          <div className="monitor-rule-form-actions">
            <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>{saving ? "Сохраняем…" : "Сохранить правило"}</button>
            <button type="button" onClick={() => { setEditingId(null); setRuleId(""); }} disabled={saving}>Отмена</button>
          </div>
        </div>
      )}
      {message && <div className="monitor-settings-message">{message}</div>}
    </section>
  );
}

export function MonitoringTab({ focusDeviceId }: { focusDeviceId?: string | null }) {
  const { clients } = useData();
  const { myProfile } = useAuth();
  const [devices, setDevices] = useState<MonitoringDevice[]>([]);
  const [states, setStates] = useState<Map<string, MonitoringDeviceState>>(new Map());
  const [controllerStatuses, setControllerStatuses] = useState<Map<string, MonitoringControllerStatus>>(new Map());
  const [sourceStatus,setSourceStatus]=useState<MonitorSources>({devices:"loading",states:"loading",controllers:"loading",settings:"loading"});
  const [sourceErrors,setSourceErrors]=useState<Partial<Record<MonitorSource,string>>>({});
  const [actionError,setActionError]=useState("");
  const [threshold, setThreshold] = useState(DEFAULT_OFFLINE_THRESHOLD_MINUTES);
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sensors, setSensors] = useState<MonitoringSensor[]>([]);
  const [sensorStates, setSensorStates] = useState<Map<string, MonitoringSensorState>>(new Map());
  const [sensorsLoading, setSensorsLoading] = useState(false);
  const [period, setPeriod] = useState<MonitoringPeriod>("hour");
  const [sensorHistories, setSensorHistories] = useState<Map<string, MonitoringHistoryResult>>(new Map());
  const [loadingSensorHistories, setLoadingSensorHistories] = useState<Set<string>>(new Set());
  const [sensorHistoryErrors, setSensorHistoryErrors] = useState<Map<string, string>>(new Map());
  const [rules, setRules] = useState<MonitoringTemperatureRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());
  const [renamingDevice, setRenamingDevice] = useState<MonitoringDevice | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState("");

  const [sensorOwner,setSensorOwner]=useState<string|null>(null);
  const [sensorStatesReady,setSensorStatesReady]=useState(false);
  const [sensorErrors,setSensorErrors]=useState({registry:"",states:""});
  const sensorError=Object.values(sensorErrors).filter(Boolean).join(" · ");
  const [rulesOwner,setRulesOwner]=useState<string|null>(null);
  const [historyOwner,setHistoryOwner]=useState("");
  const [overviewFilters,setOverviewFilters]=useState(DEFAULT_MONITOR_FILTERS);
  const [detailView,setDetailView]=useState("temperature");
  const [sensorFilter,setSensorFilter]=useState("all");
  useEffect(()=>{setDetailView("temperature");setSensorFilter("all");},[selectedId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (focusDeviceId) setSelectedId(focusDeviceId);
  }, [focusDeviceId]);

  useEffect(()=>{
    let active=true;
    const ready=(key:MonitorSource)=>{if(!active)return;setSourceStatus(current=>({...current,[key]:"ready"}));setSourceErrors(current=>({...current,[key]:""}));};
    const fail=(key:MonitorSource)=>(error:Error)=>{if(!active)return;setSourceStatus(current=>({...current,[key]:"error"}));setSourceErrors(current=>({...current,[key]:error.message||"Не удалось подтвердить источник"}));};
    const stops=[
      listenMonitoringDevices(next=>{if(active){setDevices(next);ready("devices");}},fail("devices")),
      listenMonitoringStates(next=>{if(active){setStates(next);ready("states");}},fail("states")),
      listenMonitoringControllerStatuses(next=>{if(active){setControllerStatuses(next);ready("controllers");}},fail("controllers")),
      listenMonitoringSettings(next=>{if(active){setThreshold(next);ready("settings");}},fail("settings")),
    ];
    return ()=>{active=false;stops.forEach(stop=>stop());};
  },[]);

  useEffect(()=>{
    let active=true;
    setSensorOwner(selectedId);setSensors([]);setSensorStates(new Map());setSensorStatesReady(false);setSensorErrors({registry:"",states:""});
    if(!selectedId){setSensorsLoading(false);return;}
    setSensorsLoading(true);
    const stopSensors=listenMonitoringDeviceSensors(selectedId,next=>{if(active){setSensors(next);setSensorsLoading(false);setSensorErrors(current=>({...current,registry:""}));}},error=>{if(active){setSensorErrors(current=>({...current,registry:error.message||"Не удалось загрузить реестр датчиков"}));setSensorsLoading(false);}});
    const stopStates=listenMonitoringSensorStates(selectedId,next=>{if(active){setSensorStates(next);setSensorStatesReady(true);setSensorErrors(current=>({...current,states:""}));}},error=>{if(active){setSensorErrors(current=>({...current,states:error.message||"Не удалось загрузить показания датчиков"}));setSensorStatesReady(true);}});
    return ()=>{active=false;stopSensors();stopStates();};
  },[selectedId]);

  useEffect(()=>{
    let active=true;
    setRulesOwner(selectedId);setRules([]);setRulesError("");
    if(!selectedId){setRulesLoading(false);return;}
    setRulesLoading(true);
    const stop=listenMonitoringTemperatureRules(selectedId,next=>{if(active){setRules(next);setRulesLoading(false);setRulesError("");}},error=>{if(active){setRulesError(error.message||"Не удалось загрузить правила");setRulesLoading(false);}});
    return ()=>{active=false;stop();};
  },[selectedId]);

  const selectedDevice = devices.find((device) => device.id === selectedId);
  const role = myProfile?.role ?? "mechanic";
  const canManageSettings = role === "owner" || role === "admin" || role === "manager";
  const rows=useMemo(()=>monitorRows(devices,states,controllerStatuses,clients,nowMs,threshold),[devices,states,controllerStatuses,clients,nowMs,threshold]);
  const selectedRow=rows.find(row=>row.device.id===selectedId);
  const sensorsBusy=sensorOwner!==selectedId||sensorsLoading||!sensorStatesReady;
  const sensorViews=useMemo(()=>selectedSensorViews({selectedId,owner:sensorOwner,registryReady:!sensorsLoading,statesReady:sensorStatesReady,error:sensorError,sensors,states:sensorStates,parent:selectedDevice?states.get(selectedDevice.id):undefined}),[selectedId,sensorOwner,sensorsLoading,sensorStatesReady,sensorError,sensors,sensorStates,selectedDevice,states]);
  const visibleSensors=sensorFilter==="all"?sensorViews:sensorViews.filter(item=>item.sensorId===sensorFilter);
  const selectedRules=rulesOwner===selectedId?rules:[];

  const sensorIdsKey = sensorViews.map((item) => item.sensorId).join("\u0000");

  const historyScope=JSON.stringify([selectedId,sensorIdsKey,period]);
  useEffect(()=>{
    let active=true;
    setSensorHistories(new Map());setSensorHistoryErrors(new Map());setHistoryOwner(historyScope);
    if(!selectedId||!sensorViews.length){setLoadingSensorHistories(new Set());return;}
    setLoadingSensorHistories(new Set(sensorViews.map(item=>item.sensorId)));
    const stops=sensorViews.map(item=>listenDeviceHistory(selectedId,item.sensorId,period,result=>{
      if(!active)return;
      setSensorHistories(current=>new Map(current).set(item.sensorId,result));
      setSensorHistoryErrors(current=>{if(!current.has(item.sensorId))return current;const next=new Map(current);next.delete(item.sensorId);return next;});
      setLoadingSensorHistories(current=>{const next=new Set(current);next.delete(item.sensorId);return next;});
    },error=>{
      if(!active)return;
      setSensorHistoryErrors(current=>new Map(current).set(item.sensorId,error.message||"Не удалось загрузить историю"));
      setLoadingSensorHistories(current=>{const next=new Set(current);next.delete(item.sensorId);return next;});
    }));
    return ()=>{active=false;stops.forEach(stop=>stop());};
  // Selection key intentionally ignores incoming value updates; telemetry never recreates history listeners.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[historyScope]);

  async function changeThreshold(value: number) {
    setThresholdSaving(true);
    setActionError("");
    try {
      await saveOfflineThreshold(value);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Не удалось сохранить порог связи");
    } finally {
      setThresholdSaving(false);
    }
  }

  async function saveDeviceName(name: string) {
    if (!renamingDevice) return;
    setRenameSaving(true); setRenameError("");
    try {
      await renameMonitoringDevice(renamingDevice.id, name);
      setRenamingDevice(null);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "Не удалось сохранить название контроллера");
    } finally { setRenameSaving(false); }
  }


  if (selectedDevice) {
    const state = states.get(selectedDevice.id);
    const controllerStatus = controllerStatuses.get(selectedDevice.id);
    const status = {reading:selectedRow?.reading??"missing"};
    const connection = selectedRow?.connection??"unknown";
    const activeAlertCount = Object.keys(state?.activeAlertIds ?? {}).length;
    return (
      <div className="monitor-page monitor-workspace monitor-detail-workspace" key={selectedDevice.id}>
        <button type="button" className="monitor-back" onClick={() => setSelectedId(null)}>
          <i className="ti ti-arrow-left" /> Все устройства
        </button>
        <MonitoringSourceBoundary status={sourceStatus}>
        <section className="monitor-detail-head">
          <div>
            <div className="monitor-title-row">
              <h2>{selectedDevice.name}</h2>
              {selectedDevice.isTest && <span className="monitor-test-badge">Тестовое устройство</span>}
            </div>
            <p>{objectLabel(selectedDevice, clients)}</p>
            <p>ID: {selectedDevice.id}</p>
            {!selectedDevice.enabled&&<p>Устройство отключено от наблюдения. Сохранённая история доступна ниже.</p>}
            {canManageSettings&&<button type="button" className="monitor-detail-rename" onClick={()=>{setRenameError("");setRenamingDevice(selectedDevice);}}>Название контроллера</button>}
          </div>
          <div className="monitor-detail-badges">
            {activeAlertCount > 0 && <ActiveAlertBadge count={activeAlertCount} />}
            <ReadingBadge status={status.reading} />
            <ConnectionBadge status={connection} />
          </div>
        </section>

        <div className="monitor-detail-kpis">
          <div className="monitor-detail-kpi monitor-detail-kpi--temperature">
            <span>Последнее показание контроллера</span>
            <strong>{formatTemperature(state?.temperatureC)}</strong>
            <small>{status.reading === "stale" ? "Данные устарели" : "Сводное значение; датчики ниже"}</small>
          </div>
          <div className="monitor-detail-kpi">
            <span>Измерено</span>
            <strong>{relativeTime(state?.measuredAt, nowMs)}</strong>
            <small>{formatDateTime(state?.measuredAt)}</small>
          </div>
          <div className="monitor-detail-kpi">
            <span>Последний статус связи</span>
            <strong>{relativeTime(controllerStatus?.reportedAt, nowMs)}</strong>
            <small>{formatDateTime(controllerStatus?.reportedAt)}</small>
          </div>
        </div>

        <nav className="monitor-detail-view-nav" aria-label="Разделы контроллера">{[{id:"temperature",label:"Показания и графики"},{id:"connection",label:"Связь и диагностика"},{id:"rules",label:"Правила тревог"}].map(item=><button type="button" key={item.id} aria-current={detailView===item.id?"page":undefined} onClick={()=>setDetailView(item.id)}>{item.label}</button>)}</nav>
        <section className="monitor-detail-section" hidden={detailView!=="temperature"} aria-label="Показания и графики"><label className="monitor-detail-sensor-filter">Показать датчики<select value={sensorFilter} onChange={e=>setSensorFilter(e.target.value)}><option value="all">Все датчики</option>{sensorViews.map(item=><option value={item.sensorId} key={item.sensorId}>{sensorDisplayName(item.sensor,item.index)}</option>)}</select></label>
        <section className="crm-section monitor-sensors">
          <div className="section-header">
            <div><div className="section-title">Датчики контроллера</div><div className="monitor-history-subtitle">Название можно изменить без смены технического ID и истории.</div></div>
            <span className="monitor-sensor-count">{sensorViews.length}</span>
          </div>
          {sensorError ? <div className="monitor-workspace-error" role="alert">{sensorError}</div> : sensorsBusy ? <div className="monitor-loading" role="status">Загружаем реестр и показания датчиков…</div> : sensorViews.length === 0 ? (
            <div className="monitor-rules-empty">Контроллер ещё не передал измерения.</div>
          ) : (
            <div className="monitor-sensor-grid">
              {visibleSensors.map((item) => {
                const itemStatus = {reading:monitorReading(item.state,nowMs,threshold)};
                return <div key={item.sensorId} className="monitor-sensor-card" style={{"--monitor-sensor-color":monitorSensorColor(item.sensorId)} as CSSProperties}>
                  <div className="monitor-sensor-card-head"><span className="monitor-sensor-title"><SensorNameEditor deviceId={selectedDevice.id} sensor={item.sensor} displayName={sensorDisplayName(item.sensor, item.index)} canManage={canManageSettings} /></span><ReadingBadge status={itemStatus.reading} /></div>
                  <div className="monitor-sensor-select">
                    <strong className="monitor-sensor-temperature">{formatTemperature(item.state?.temperatureC)}</strong>
                    <span className="monitor-sensor-meta">Измерено: {relativeTime(item.state?.measuredAt, nowMs)}</span>
                    <span className="monitor-sensor-id">ID: {item.sensorId}</span>
                  </div>
                </div>;
              })}
            </div>
          )}
        </section>

        <section className="crm-section monitor-history">
          <div className="section-header monitor-history-header">
            <div>
              <div className="section-title">Графики температуры</div>
              <div className="monitor-history-subtitle">
                Каждый график использует только точки своего датчика и не смешивает серии.
              </div>
            </div>
            <div className="monitor-period-tabs" aria-label="Период графика">
              {(["hour", "halfDay", "day", "threeDays", "week", "month"] as MonitoringPeriod[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={period === value ? "active" : ""}
                  onClick={() => setPeriod(value)}
                >
                  {periodLabel(value)}
                </button>
              ))}
            </div>
          </div>
          {sensorError?<div className="monitor-workspace-error" role="alert">История недоступна без подтверждения датчиков: {sensorError}</div>:sensorsBusy?<div className="monitor-loading" role="status">Подтверждаем список датчиков…</div>:sensorViews.length === 0 ? <div className="monitor-rules-empty">Контроллер ещё не передал датчики.</div> : (
            <div className="monitor-sensor-history-list">
              {visibleSensors.map((item) => <SensorHistoryChart
                key={item.sensorId}
                sensorName={sensorDisplayName(item.sensor, item.index)}
                sensorId={item.sensorId}
                history={historyOwner===historyScope? sensorHistories.get(item.sensorId) ?? EMPTY_HISTORY:EMPTY_HISTORY}
                loading={historyOwner!==historyScope||loadingSensorHistories.has(item.sensorId)}
                error={historyOwner===historyScope?sensorHistoryErrors.get(item.sensorId):undefined}
                period={period}
                rules={selectedRules}
              />)}
            </div>
          )}
        </section>
        </section>
        <section className="monitor-detail-section" hidden={detailView!=="connection"} aria-label="Связь и диагностика">{connection!=="online"&&<p className="monitor-workspace-error">Связь не подтверждена. Ниже — последний полученный диагностический снимок.</p>}
        <DiagnosticsPanel status={controllerStatus} connection={connection} nowMs={nowMs} />


        </section>
        <section className="monitor-detail-section" hidden={detailView!=="rules"} aria-label="Правила тревог">
        <TemperatureRulesPanel
          deviceId={selectedDevice.id}
          sensors={sensorViews.map((item) => ({ sensorId: item.sensorId, name: sensorDisplayName(item.sensor, item.index) }))}
          rules={selectedRules}
          loading={rulesLoading||rulesOwner!==selectedId}
          error={rulesError}
          canManage={canManageSettings&&!sensorsBusy&&!sensorError&&rulesOwner===selectedId}
        />


        </section>
        </MonitoringSourceBoundary>
        {renamingDevice&&<RenameMonitoringDeviceDialog device={renamingDevice} saving={renameSaving} blocked={!monitorSourcesReady(sourceStatus)} error={renameError} onClose={()=>!renameSaving&&setRenamingDevice(null)} onSave={name=>void saveDeviceName(name)}/>}

      </div>
    );
  }

  return <>
    {selectedId&&sourceStatus.devices==="ready"&&!selectedDevice&&<p className="monitor-workspace-error" role="alert">Устройство не найдено в реестре. Возможно, запись была удалена или доступ изменился.</p>}
    <MonitoringOverview filters={overviewFilters} onFiltersChange={setOverviewFilters} rows={rows} sourceStatus={sourceStatus} sourceErrors={sourceErrors} actionError={actionError} nowMs={nowMs} threshold={threshold} thresholdSaving={thresholdSaving} canManage={canManageSettings} onThreshold={value=>void changeThreshold(value)} onOpen={setSelectedId} onRename={device=>{setRenameError("");setRenamingDevice(device);}}/>
    {renamingDevice&&<RenameMonitoringDeviceDialog device={renamingDevice} saving={renameSaving} blocked={!monitorSourcesReady(sourceStatus)} error={renameError} onClose={()=>!renameSaving&&setRenamingDevice(null)} onSave={name=>void saveDeviceName(name)}/>}
  </>;
}
