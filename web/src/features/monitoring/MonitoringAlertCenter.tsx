import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth";
import { useData } from "../../shared/context/DataContext";
import {
  listenMonitoringAlerts,
  markMonitoringAlertViewed,
} from "../../shared/firebase/monitoring";
import { objectLabel } from "../../shared/monitoring/logic";
import type { MonitoringAlertEvent } from "../../shared/types/monitoring";

function localDateTime(value: Date | null): string {
  return value
    ? value.toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
    : "—";
}

function stateLabel(event: MonitoringAlertEvent): string {
  if (event.state === "active") return event.direction === "above"
    ? "Температура выше порога"
    : "Температура ниже порога";
  if (event.state === "recovered") return "Температура восстановилась";
  if (event.state === "historical") return "Историческое нарушение правила";
  if (event.closedReason === "rule_disabled") return "Закрыто: правило отключено";
  if (event.closedReason === "rule_deleted") return "Закрыто: правило удалено";
  if (event.closedReason === "device_disabled") return "Закрыто: устройство отключено";
  return "Закрыто: правило изменено";
}

function ruleCondition(event: MonitoringAlertEvent): string {
  return `${event.direction === "above" ? "выше" : "ниже"} ${event.thresholdC.toFixed(1)} °C`;
}

export function MonitoringAlertCenter({ onOpenDevice }: {
  onOpenDevice: (deviceId: string) => void;
}) {
  const { user } = useAuth();
  const { clients } = useData();
  const rootRef = useRef<HTMLDivElement>(null);
  const [events, setEvents] = useState<MonitoringAlertEvent[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [markingId, setMarkingId] = useState<string | null>(null);

  useEffect(() => {
    setLoaded(false);
    setError("");
    return listenMonitoringAlerts((next) => {
      setEvents(next);
      setLoaded(true);
    }, (nextError) => {
      setError(nextError.message || "Не удалось загрузить аварии");
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open]);

  const uid = user?.uid ?? "";
  const unread = useMemo(
    () => events.filter((event) => uid && !event.viewedBy[uid]),
    [events, uid],
  );

  async function markViewed(eventId: string) {
    if (!uid) return;
    setMarkingId(eventId);
    setError("");
    try {
      await markMonitoringAlertViewed(eventId, uid);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Не удалось поставить отметку");
    } finally {
      setMarkingId(null);
    }
  }

  return (
    <div className="monitor-alert-center" ref={rootRef}>
      <button
        type="button"
        className={`monitor-alert-button ${unread.length ? "monitor-alert-button--unread" : ""}`}
        aria-label={`Температурные аварии: ${unread.length} непросмотренных`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <i className="ti ti-bell-ringing" />
        {unread.length > 0 && <span>{unread.length > 99 ? "99+" : unread.length}</span>}
      </button>

      {open && (
        <div className="monitor-alert-panel" role="dialog" aria-label="Температурные аварии">
          <div className="monitor-alert-panel-head">
            <div><strong>Температурные аварии</strong><span>{unread.length} непросмотренных</span></div>
            <button type="button" aria-label="Закрыть" onClick={() => setOpen(false)}>
              <i className="ti ti-x" />
            </button>
          </div>
          {error && <div className="monitor-alert-panel-error">{error}</div>}
          {!loaded ? (
            <div className="monitor-alert-panel-empty">Загружаем события…</div>
          ) : events.length === 0 ? (
            <div className="monitor-alert-panel-empty">Аварий пока нет</div>
          ) : (
            <div className="monitor-alert-list">
              {events.map((event) => {
                const isUnread = Boolean(uid && !event.viewedBy[uid]);
                return (
                  <article key={event.id} className={`monitor-alert-event ${isUnread ? "is-unread" : ""}`}>
                    <button
                      type="button"
                      className="monitor-alert-event-main"
                      onClick={() => {
                        onOpenDevice(event.deviceId);
                        setOpen(false);
                      }}
                    >
                      <span className="monitor-alert-event-title">
                        <strong>{event.deviceName}</strong>
                        <em>{stateLabel(event)}</em>
                      </span>
                      <span>Правило: {event.ruleName} · {ruleCondition(event)}</span>
                      <span>{objectLabel(event, clients)}</span>
                      <span className="monitor-alert-event-values">
                        {event.temperatureC.toFixed(1)} °C · порог {event.thresholdC.toFixed(1)} °C
                      </span>
                      <span>
                        {event.direction === "above" ? "Превышение" : "Понижение"} зафиксировано: {localDateTime(event.detectedMeasuredAt)}
                      </span>
                      <span>Получено сервером: {localDateTime(event.detectedReceivedAt)}</span>
                      {event.recoveredMeasuredAt && (
                        <span>Восстановление зафиксировано: {localDateTime(event.recoveredMeasuredAt)}</span>
                      )}
                    </button>
                    {isUnread ? (
                      <button
                        type="button"
                        className="monitor-alert-viewed"
                        disabled={markingId === event.id}
                        onClick={() => void markViewed(event.id)}
                      >
                        {markingId === event.id ? "Сохраняем…" : "Просмотрено"}
                      </button>
                    ) : <span className="monitor-alert-read-label">Просмотрено</span>}
                  </article>
                );
              })}
            </div>
          )}
          {events.length >= 200 && (
            <div className="monitor-alert-panel-limit">Показаны 200 последних событий.</div>
          )}
        </div>
      )}
    </div>
  );
}
