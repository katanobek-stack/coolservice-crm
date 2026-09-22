import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useAuth } from "../auth";
import { useData } from "../../shared/context/DataContext";
import {
  DEFAULT_OFFLINE_THRESHOLD_MINUTES,
  deleteMonitoringTemperatureRule,
  listenDeviceHistory,
  listenDeviceUnplacedHistory,
  listenMonitoringDevices,
  listenMonitoringControllerStatuses,
  listenMonitoringSettings,
  listenMonitoringStates,
  listenMonitoringTemperatureRules,
  saveMonitoringTemperatureRule,
  saveOfflineThreshold,
} from "../../shared/firebase/monitoring";
import {
  monitoringStatus,
  controllerConnectionStatus,
  downsampleTemperaturePoints,
  temperatureChartSegments,
  monitoringPeriodMs,
  chartXAxisTicks,
  panChartWindow,
  resizeChartWindow,
  zoomChartWindow,
  placeUnplacedPoints,
  type ChartWindow,
  type ConnectionStatus,
  type ReadingStatus,
} from "../../shared/monitoring/logic";
import type {
  MonitoringDevice,
  MonitoringDeviceState,
  MonitoringControllerStatus,
  MonitoringHistoryResult,
  MonitoringPeriod,
  MonitoringTemperatureRule,
  TemperaturePoint,
  UnplacedTemperaturePoint,
} from "../../shared/types/monitoring";
import "./monitoring.css";

const EMPTY_HISTORY: MonitoringHistoryResult = {
  points: [],
  packetCount: 0,
  limitReached: false,
};

function formatTemperature(value: number | undefined): string {
  if (value === undefined) return "—";
  return `${value.toFixed(1)} °C`;
}

function formatDateTime(value: Date | null | undefined): string {
  if (!value) return "Нет данных";
  return value.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function relativeTime(value: Date | null | undefined, nowMs: number): string {
  if (!value) return "Нет данных";
  const seconds = Math.max(0, Math.floor((nowMs - value.getTime()) / 1_000));
  if (seconds < 30) return "только что";
  if (seconds < 60) return `${seconds} сек. назад`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин. назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч. назад`;
  return `${Math.floor(hours / 24)} дн. назад`;
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

function periodLabel(period: MonitoringPeriod): string {
  if (period === "hour") return "1 час";
  if (period === "halfDay") return "12 часов";
  if (period === "day") return "24 часа";
  if (period === "threeDays") return "3 дня";
  if (period === "week") return "7 дней";
  return "30 дней";
}

const DELAYED_DELIVERY_MESSAGE = "Точка измерена при отсутствии подтверждённой MQTT-связи и доставлена позже";

function qualityDetails(point: TemperaturePoint): string[] {
  const details: string[] = [];
  if (point.timeQuality === "unplaced") details.push("Время приблизительное — измерение без достоверного времени, размещено между соседними точками");
  if (point.timeQuality === "estimated") details.push("Время оценочное — восстановлено после отсутствия UTC");
  if (point.deliveryQuality === "delayed") details.push(DELAYED_DELIVERY_MESSAGE);
  return details;
}

function chartAxisLabel(timestamp: number, spanMs: number): string {
  const date = new Date(timestamp);
  return spanMs > 24 * 60 * 60_000
    ? date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
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
  const [baseEndMs, setBaseEndMs] = useState(() => Date.now());
  useEffect(() => {
    setBaseEndMs(Date.now());
    setZoom(null);
    setSelectedPointMs(null);
  }, [period]);
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
  const timedVisiblePoints = visiblePoints.filter((point) => point.timeQuality !== "unplaced");
  const unplacedVisibleCount = visiblePoints.length - timedVisiblePoints.length;
  const temperatures = timedVisiblePoints.map((point) => point.temperatureC);
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
  const estimatedCount = timedVisiblePoints.filter((point) => point.timeQuality === "estimated").length;
  const delayedCount = timedVisiblePoints.filter((point) => point.deliveryQuality === "delayed").length;
  const hasUnplacedPoints = visiblePoints.some((point) => point.timeQuality === "unplaced");
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
        <div><span>Получено за период</span><strong>{timedVisiblePoints.length}</strong></div>
        <div><span>Без времени (на графике)</span><strong>{unplacedVisibleCount}</strong></div>
        <div><span>Оценочное время</span><strong>{estimatedCount}</strong></div>
        <div><span>Доставлено позже</span><strong>{delayedCount}</strong></div>
      </div>
      {rendered.length < visiblePoints.length && (
        <div className="monitor-history-subtitle">На графике показано {rendered.length} из {visiblePoints.length} точек</div>
      )}
      <button type="button" className="monitor-chart-reset" onClick={() => setZoom(null)} disabled={!zoom}>Сбросить масштаб</button>
      <div className="monitor-chart-scroll" aria-label="График температуры" onWheel={(event) => {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const focusFraction = (event.clientX - rect.left) / rect.width;
        setZoom(zoomChartWindow(visibleWindow, startMs, nowMs, focusFraction, event.deltaY < 0 ? 0.75 : 1.33));
      }}>
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
        {hasUnplacedPoints && (
          <span><i className="monitor-legend-line monitor-legend-line--unplaced" /> Время приблизительное — измерение без достоверного времени из памяти контроллера</span>
        )}
        <span><i className="monitor-legend-line monitor-legend-line--estimated" /> Пунктир: время оценочное — восстановлено после отсутствия UTC</span>
        <span>Линия лишь соединяет соседние измерения и не означает наличие данных между ними</span>
        {enabledRules.length > 0 && <span><i className="monitor-legend-limit" /> Пороги включённых правил</span>}
      </div>
    </>
  );
}

function UnplacedMeasurements({ points }: { points: UnplacedTemperaturePoint[] }) {
  return (
    <section className="monitor-unplaced" aria-label="Точки без достоверного времени">
      <div className="monitor-unplaced-head">
        <strong>Без достоверного времени</strong>
        <span>{points.length}</span>
      </div>
      <p>Измерения без достоверного времени, накопленные контроллером в памяти. На графике размещены приблизительно (фиолетовым), в статистику не входят.</p>
      {points.length === 0 ? (
        <div className="monitor-unplaced-empty">Таких точек нет.</div>
      ) : (
        <ul className="monitor-unplaced-list">
          {points.map((point, index) => (
            <li key={`${point.packetId}-${index}`}>
              <strong>{point.temperatureC.toFixed(1)} °C</strong>
              <span>{point.packetId}</span>
              <time>Получено: {formatDateTime(point.receivedAt)}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function objectLabel(device: MonitoringDevice, clients: ReturnType<typeof useData>["clients"]): string {
  if (!device.clientId || !device.targetType || !device.targetId) return "Объект не привязан";
  const client = clients.find((item) => item.id === device.clientId);
  if (!client) return `Клиент ${device.clientId} · объект ${device.targetId}`;
  if (device.targetType === "vehicle") {
    const vehicle = (client.vehicles ?? []).find((item) => item.id === device.targetId);
    const vehicleName = vehicle
      ? [vehicle.brand ?? vehicle.model, vehicle.plate].filter(Boolean).join(" · ")
      : `автомобиль ${device.targetId}`;
    return `${client.name} · ${vehicleName}`;
  }
  const chamber = (client.chambers ?? []).find((item) => item.id === device.targetId);
  return `${client.name} · ${chamber?.notes?.trim() || `камера ${device.targetId}`}`;
}

function TemperatureRulesPanel({ deviceId, rules, loading, error, canManage }: {
  deviceId: string;
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
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  function resetForm() {
    setEditingId(null);
    setRuleId(`rule-${Date.now().toString(36)}`);
    setName("");
    setEnabled(true);
    setDirection("above");
    setThreshold("-15");
    setMessage("");
  }

  function edit(rule: MonitoringTemperatureRule) {
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
    if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(ruleId) || !name.trim() || !Number.isFinite(thresholdC)) {
      setMessage("Проверьте ID, название и числовой порог правила.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await saveMonitoringTemperatureRule(deviceId, {
        id: ruleId,
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
        {canManage && (
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
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [statesLoaded, setStatesLoaded] = useState(false);
  const [controllerStatusesLoaded, setControllerStatusesLoaded] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const [threshold, setThreshold] = useState(DEFAULT_OFFLINE_THRESHOLD_MINUTES);
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [period, setPeriod] = useState<MonitoringPeriod>("hour");
  const [history, setHistory] = useState<MonitoringHistoryResult>(EMPTY_HISTORY);
  const [unplacedPoints, setUnplacedPoints] = useState<UnplacedTemperaturePoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [rules, setRules] = useState<MonitoringTemperatureRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (focusDeviceId) setSelectedId(focusDeviceId);
  }, [focusDeviceId]);

  useEffect(() => {
    setOverviewError("");
    const unsubscribeDevices = listenMonitoringDevices((nextDevices) => {
      setDevices(nextDevices);
      setDevicesLoaded(true);
    }, (error) => {
      setDevicesLoaded(true);
      setOverviewError(error.message || "Не удалось загрузить реестр устройств");
    });
    const unsubscribeStates = listenMonitoringStates((nextStates) => {
      setStates(nextStates);
      setStatesLoaded(true);
    }, (error) => {
      setStatesLoaded(true);
      setOverviewError(error.message || "Не удалось загрузить состояния устройств");
    });
    const unsubscribeControllerStatuses = listenMonitoringControllerStatuses((nextStatuses) => {
      setControllerStatuses(nextStatuses);
      setControllerStatusesLoaded(true);
    }, (error) => {
      setControllerStatusesLoaded(true);
      setOverviewError(error.message || "Не удалось загрузить статусы контроллеров");
    });
    const unsubscribeSettings = listenMonitoringSettings(setThreshold, (error) => {
      setOverviewError(error.message || "Не удалось загрузить настройки мониторинга");
    });
    return () => {
      unsubscribeDevices();
      unsubscribeStates();
      unsubscribeControllerStatuses();
      unsubscribeSettings();
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setHistory(EMPTY_HISTORY);
      setUnplacedPoints([]);
      setHistoryLoading(false);
      setHistoryError("");
      return;
    }
    setHistory(EMPTY_HISTORY);
    setHistoryLoading(true);
    setHistoryError("");
    const unsubscribe = listenDeviceHistory(selectedId, period, (result) => {
      setHistory(result);
      setHistoryLoading(false);
    }, (error) => {
      setHistoryError(error.message || "Не удалось загрузить историю");
      setHistoryLoading(false);
    });
    return unsubscribe;
  }, [selectedId, period]);

  useEffect(() => {
    if (!selectedId) return undefined;
    return listenDeviceUnplacedHistory(selectedId, setUnplacedPoints, (error) => {
      setHistoryError(error.message || "Не удалось загрузить точки без достоверного времени");
    });
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setRules([]);
      setRulesLoading(false);
      setRulesError("");
      return;
    }
    setRules([]);
    setRulesLoading(true);
    setRulesError("");
    return listenMonitoringTemperatureRules(selectedId, (nextRules) => {
      setRules(nextRules);
      setRulesLoading(false);
    }, (error) => {
      setRulesError(error.message || "Не удалось загрузить правила");
      setRulesLoading(false);
    });
  }, [selectedId]);

  const placedUnplacedPoints = useMemo(
    () => placeUnplacedPoints(history.points, unplacedPoints),
    [history.points, unplacedPoints],
  );
  const chartPoints = useMemo(
    () => [...history.points, ...placedUnplacedPoints],
    [history.points, placedUnplacedPoints],
  );

  const selectedDevice = devices.find((device) => device.id === selectedId);
  const role = myProfile?.role ?? "mechanic";
  const canManageSettings = role === "owner" || role === "admin" || role === "manager";
  const loading = !devicesLoaded || !statesLoaded || !controllerStatusesLoaded;

  async function changeThreshold(value: number) {
    setThresholdSaving(true);
    setOverviewError("");
    try {
      await saveOfflineThreshold(value);
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : "Не удалось сохранить порог связи");
    } finally {
      setThresholdSaving(false);
    }
  }

  if (selectedDevice) {
    const state = states.get(selectedDevice.id);
    const controllerStatus = controllerStatuses.get(selectedDevice.id);
    const status = monitoringStatus(state, nowMs, threshold);
    const connection = controllerConnectionStatus(controllerStatus, nowMs, threshold);
    const activeAlertCount = Object.keys(state?.activeAlertIds ?? {}).length;
    return (
      <div className="monitor-page">
        <button type="button" className="monitor-back" onClick={() => setSelectedId(null)}>
          <i className="ti ti-arrow-left" /> Все устройства
        </button>
        <section className="monitor-detail-head">
          <div>
            <div className="monitor-title-row">
              <h2>{selectedDevice.name}</h2>
              {selectedDevice.isTest && <span className="monitor-test-badge">Тестовое устройство</span>}
            </div>
            <p>{objectLabel(selectedDevice, clients)}</p>
          </div>
          <div className="monitor-detail-badges">
            {activeAlertCount > 0 && <ActiveAlertBadge count={activeAlertCount} />}
            <ReadingBadge status={status.reading} />
            <ConnectionBadge status={connection} />
          </div>
        </section>

        <div className="monitor-detail-kpis">
          <div className="monitor-detail-kpi monitor-detail-kpi--temperature">
            <span>Последняя температура</span>
            <strong>{formatTemperature(state?.temperatureC)}</strong>
            <small>{status.reading === "stale" ? "Данные устарели" : "По времени измерения"}</small>
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

        <DiagnosticsPanel status={controllerStatus} connection={connection} nowMs={nowMs} />

        <TemperatureRulesPanel
          deviceId={selectedDevice.id}
          rules={rules}
          loading={rulesLoading}
          error={rulesError}
          canManage={canManageSettings}
        />

        <section className="crm-section monitor-history">
          <div className="section-header monitor-history-header">
            <div>
              <div className="section-title">История температуры</div>
              <div className="monitor-history-subtitle">
                Загружается только для открытого устройства
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
          <div className="monitor-chart-body">
            {historyLoading ? (
              <div className="monitor-loading"><i className="ti ti-loader-2" /> Загружаем историю…</div>
            ) : historyError ? (
              <div className="monitor-error">
                <i className="ti ti-alert-triangle" />
                <div><strong>История недоступна</strong><span>{historyError}</span></div>
              </div>
            ) : (
              <>
                <TemperatureChart
                  points={chartPoints}
                  period={period}
                  rules={rules}
                />
                <UnplacedMeasurements points={unplacedPoints} />
              </>
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="monitor-page">
      <div className="monitor-page-intro">
        <div>
          <h2>Контроль температуры</h2>
          <p>Текущие показания и состояние связи оборудования клиентов.</p>
        </div>
        <label className="monitor-threshold">
          <span>Нет связи после</span>
          <select
            value={threshold}
            disabled={!canManageSettings || thresholdSaving}
            onChange={(event) => void changeThreshold(Number(event.target.value))}
            title={canManageSettings ? "Настроить порог отсутствия связи" : "Настройка доступна менеджеру"}
          >
            {[2, 5, 10, 15, 30, 60].map((minutes) => (
              <option key={minutes} value={minutes}>{minutes} мин.</option>
            ))}
          </select>
        </label>
      </div>

      {overviewError && (
        <div className="monitor-error">
          <i className="ti ti-alert-triangle" />
          <div><strong>Не удалось загрузить мониторинг</strong><span>{overviewError}</span></div>
        </div>
      )}

      {loading ? (
        <div className="monitor-loading"><i className="ti ti-loader-2" /> Загружаем устройства…</div>
      ) : devices.length === 0 ? (
        <div className="monitor-empty">
          <i className="ti ti-device-desktop-off" />
          <strong>Устройства ещё не добавлены</strong>
          <span>На этом этапе реестр создаётся через защищённый Admin-процесс.</span>
        </div>
      ) : (
        <div className="monitor-device-grid">
          {devices.map((device) => {
            const state = states.get(device.id);
            const controllerStatus = controllerStatuses.get(device.id);
            const status = monitoringStatus(state, nowMs, threshold);
            const connection = controllerConnectionStatus(controllerStatus, nowMs, threshold);
            const activeAlertCount = Object.keys(state?.activeAlertIds ?? {}).length;
            return (
              <button
                type="button"
                className="monitor-device-card"
                key={device.id}
                onClick={() => setSelectedId(device.id)}
              >
                <div className="monitor-card-head">
                  <div className="monitor-device-icon"><i className="ti ti-temperature" /></div>
                  <div className="monitor-device-name">
                    <strong>{device.name}</strong>
                    <span>{objectLabel(device, clients)}</span>
                  </div>
                  <i className="ti ti-chevron-right monitor-card-arrow" />
                </div>
                <div className="monitor-card-temperature">
                  {formatTemperature(state?.temperatureC)}
                </div>
                <div className="monitor-card-badges">
                  {device.isTest && <span className="monitor-test-badge">Тест</span>}
                  {!device.enabled && <span className="monitor-badge monitor-badge--disabled">Отключено</span>}
                  {activeAlertCount > 0 && <ActiveAlertBadge count={activeAlertCount} />}
                  <ReadingBadge status={status.reading} />
                  <ConnectionBadge status={connection} />
                </div>
                <div className="monitor-card-times">
                  <div><span>Измерено</span><strong>{relativeTime(state?.measuredAt, nowMs)}</strong></div>
                  <div><span>Статус связи</span><strong>{relativeTime(controllerStatus?.reportedAt, nowMs)}</strong></div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
