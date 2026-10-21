import { useEffect, useRef, useState } from "react";
import { Textarea } from "./Input";
import { appendDictation, startDictation, type Recognition } from "../utils/reportDictation";
import "./reportText.css";

export function ReportText({ value, onChange, label, placeholder, maxLength, disabled, onListeningChange }: {
  value: string; onChange(value: string): void; label: string; placeholder: string;
  maxLength: number; disabled: boolean; onListeningChange(value: boolean): void;
}) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [supported, setSupported] = useState(false);
  const session = useRef<ReturnType<typeof startDictation> | null>(null);
  const latest = useRef({ value, onChange, onListeningChange });
  latest.current = { value, onChange, onListeningChange };
  const mounted = useRef(false);
  function constructor() {
    const browser = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    return browser.SpeechRecognition || browser.webkitSpeechRecognition;
  }
  useEffect(() => {
    mounted.current = true; setSupported(Boolean(constructor()) && window.isSecureContext);
    const hide = () => { if (document.hidden) session.current?.cancel(); };
    document.addEventListener("visibilitychange", hide);
    return () => { mounted.current = false; session.current?.cancel(); document.removeEventListener("visibilitychange", hide); };
  }, []);
  useEffect(() => { if (disabled) session.current?.cancel(); }, [disabled]);
  function start() {
    if (listening) { session.current?.stop(); return; }
    const SR = constructor(); if (!SR || disabled) return;
    setError(""); setListening(true); latest.current.onListeningChange(true);
    try {
      session.current = startDictation(new SR(), {
        text(text) {
          if (!mounted.current) return;
          const next = appendDictation(latest.current.value, text, maxLength);
          latest.current.value = next.value; latest.current.onChange(next.value);
          if (next.limited) { setError(`Достигнут лимит ${maxLength} символов. Проверьте окончание отчёта.`); session.current?.stop(); }
        },
        error(message) { if (mounted.current) setError(message); },
        end() { if (mounted.current) { setListening(false); latest.current.onListeningChange(false); } },
      });
    } catch { setListening(false); latest.current.onListeningChange(false); setError("Микрофон недоступен. Введите отчёт вручную."); }
  }
  return <div className="report-text">
    <button type="button" className={`report-dictation${listening ? " is-listening" : ""}`} disabled={disabled || !supported} aria-pressed={listening} onClick={start}>
      <span aria-hidden="true">{listening ? "■" : "🎙"}</span> {listening ? "Остановить диктовку" : "Надиктовать отчёт"}
    </button>
    <p className="report-text-hint" role="status">{listening ? "Слушаю… После остановки проверьте текст и сохраните отчёт кнопкой ниже. Максимум 60 секунд." : supported ? "Нажмите, продиктуйте и остановите. Текст добавится к отчёту; автоматической отправки нет." : "Если диктовка недоступна, введите текст вручную. Нужен браузер с распознаванием речи и доступом к микрофону."}</p>
    <Textarea aria-label={label} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} maxLength={maxLength} disabled={disabled || listening} />
    {error && <p className="report-text-error" role="alert">{error}</p>}
    <small className="report-text-hint">Распознавание выполняет сервис браузера: звук может передаваться его провайдеру. Платный ИИ CRM не вызывается.</small>
  </div>;
}
