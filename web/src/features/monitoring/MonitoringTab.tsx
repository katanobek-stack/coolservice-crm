import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import { useData } from "../../shared/context/DataContext";
import {
  DEFAULT_OFFLINE_THRESHOLD_MINUTES,
  HISTORY_PACKET_LIMITS,
  listenDeviceHistory,
  listenMonitoringDevices,
  listenMonitoringSettings,
  listenMonitoringStates,
  saveOfflineThreshold,
} from "../../shared/firebase/monitoring";
import {
  downsampleSegments,
  monitoringStatus,
  splitAtGaps,
  type ConnectionStatus,
  type ReadingStatus,
} from "../../shared/monitoring/logic";
import type {
  MonitoringDevice,
  MonitoringDeviceState,
  MonitoringHistoryResult,
  MonitoringPeriod,
  TemperaturePoint,
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
    offline: "Нет связи",
    unknown: "Связь не установлена",
  };
  return <span className={`monitor-badge monitor-badge--connection-${status}`}>{labels[status]}</span>;
}

function TemperatureChart({ points, period }: {
  points: TemperaturePoint[];
  period: MonitoringPeriod;
}) {
  const segments = useMemo(
    () => downsampleSegments(splitAtGaps(points)),
    [points],
  );
  const flattened = segments.flat();
  if (flattened.length === 0) {
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
  const nowMs = Date.now();
  const startMs = nowMs - (period === "hour" ? 60 * 60_000 : 24 * 60 * 60_000);
  const temperatures = flattened.map((point) => point.temperatureC);
  const rawMin = Math.min(...temperatures);
  const rawMax = Math.max(...temperatures);
  const spread = Math.max(rawMax - rawMin, 1);
  const min = rawMin - spread * 0.12;
  const max = rawMax + spread * 0.12;

  const x = (date: Date) => padding.left
    + ((date.getTime() - startMs) / (nowMs - startMs)) * chartWidth;
  const y = (temperature: number) => padding.top
    + ((max - temperature) / (max - min)) * chartHeight;
  const yTicks = Array.from({ length: 5 }, (_, index) => min + ((max - min) * index) / 4);
  const xTicks = Array.from({ length: 5 }, (_, index) => startMs + ((nowMs - startMs) * index) / 4);
  const average = temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length;

  return (
    <>
      <div className="monitor-chart-stats">
        <div><span>Минимум</span><strong>{rawMin.toFixed(1)} °C</strong></div>
        <div><span>Средняя</span><strong>{average.toFixed(1)} °C</strong></div>
        <div><span>Максимум</span><strong>{rawMax.toFixed(1)} °C</strong></div>
        <div><span>Измерений</span><strong>{points.length}</strong></div>
      </div>
      <div className="monitor-chart-scroll" aria-label="График температуры">
        <svg className="monitor-chart" viewBox={`0 0 ${width} ${height}`} role="img">
          <title>Температура за {period === "hour" ? "последний час" : "последние сутки"}</title>
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
              x={padding.left + ((tick - startMs) / (nowMs - startMs)) * chartWidth}
              y={height - 14}
              textAnchor="middle"
              className="monitor-chart-label"
            >
              {new Date(tick).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
            </text>
          ))}
          {segments.map((segment, index) => {
            const path = segment.map((point, pointIndex) => (
              `${pointIndex === 0 ? "M" : "L"} ${x(point.measuredAt).toFixed(2)} ${y(point.temperatureC).toFixed(2)}`
            )).join(" ");
            const last = segment[segment.length - 1];
            return (
              <g key={`${segment[0].measuredAt.getTime()}-${index}`}>
                <path d={path} className="monitor-chart-line" />
                <circle cx={x(last.measuredAt)} cy={y(last.temperatureC)} r="3.5" className="monitor-chart-point" />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="monitor-chart-legend">
        <span><i className="monitor-legend-line" /> Измерения по времени датчика</span>
        <span><i className="monitor-legend-gap" /> Разрыв линии — нет измерений более 30 секунд</span>
      </div>
    </>
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

export function MonitoringTab() {
  const { clients } = useData();
  const { myProfile } = useAuth();
  const [devices, setDevices] = useState<MonitoringDevice[]>([]);
  const [states, setStates] = useState<Map<string, MonitoringDeviceState>>(new Map());
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [statesLoaded, setStatesLoaded] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const [threshold, setThreshold] = useState(DEFAULT_OFFLINE_THRESHOLD_MINUTES);
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [period, setPeriod] = useState<MonitoringPeriod>("hour");
  const [history, setHistory] = useState<MonitoringHistoryResult>(EMPTY_HISTORY);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

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
    const unsubscribeSettings = listenMonitoringSettings(setThreshold, (error) => {
      setOverviewError(error.message || "Не удалось загрузить настройки мониторинга");
    });
    return () => {
      unsubscribeDevices();
      unsubscribeStates();
      unsubscribeSettings();
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setHistory(EMPTY_HISTORY);
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

  const selectedDevice = devices.find((device) => device.id === selectedId);
  const role = myProfile?.role ?? "mechanic";
  const canManageSettings = role === "owner" || role === "admin" || role === "manager";
  const loading = !devicesLoaded || !statesLoaded;

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
    const status = monitoringStatus(state, nowMs, threshold);
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
            <ReadingBadge status={status.reading} />
            <ConnectionBadge status={status.connection} />
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
            <span>Последняя связь</span>
            <strong>{relativeTime(state?.lastReceivedAt ?? state?.receivedAt, nowMs)}</strong>
            <small>{formatDateTime(state?.lastReceivedAt ?? state?.receivedAt)}</small>
          </div>
        </div>

        <section className="crm-section monitor-history">
          <div className="section-header monitor-history-header">
            <div>
              <div className="section-title">История температуры</div>
              <div className="monitor-history-subtitle">
                Загружается только для открытого устройства
              </div>
            </div>
            <div className="monitor-period-tabs" aria-label="Период графика">
              {(["hour", "day"] as MonitoringPeriod[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={period === value ? "active" : ""}
                  onClick={() => setPeriod(value)}
                >
                  {value === "hour" ? "1 час" : "24 часа"}
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
                {history.limitReached && (
                  <div className="monitor-limit-warning">
                    Достигнут лимит {HISTORY_PACKET_LIMITS[period]} пакетов. Показаны самые новые данные периода.
                  </div>
                )}
                <TemperatureChart points={history.points} period={period} />
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
            const status = monitoringStatus(state, nowMs, threshold);
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
                  <ReadingBadge status={status.reading} />
                  <ConnectionBadge status={status.connection} />
                </div>
                <div className="monitor-card-times">
                  <div><span>Измерено</span><strong>{relativeTime(state?.measuredAt, nowMs)}</strong></div>
                  <div><span>Связь</span><strong>{relativeTime(state?.lastReceivedAt ?? state?.receivedAt, nowMs)}</strong></div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
