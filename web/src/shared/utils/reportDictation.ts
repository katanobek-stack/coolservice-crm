// Shared report dictation only: no CRM commands, API calls, uploads or automatic saves.
export interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
let cancelCurrent: (() => void) | undefined;
export function appendDictation(value: string, text: string, limit: number) {
  const next = [value.trimEnd(), text.trim()].filter(Boolean).join(" ");
  return { value: next.slice(0, limit), limited: next.length > limit };
}
export function dictationError(code: string) {
  return ({ "not-allowed": "Разрешите доступ к микрофону в настройках браузера.", "service-not-allowed": "Браузер запретил распознавание речи.", "audio-capture": "Микрофон не найден или занят.", network: "Ошибка связи с сервисом распознавания. Проверьте интернет.", "no-speech": "Речь не распознана. Попробуйте ещё раз." } as Record<string, string>)[code] || "Не удалось распознать речь. Можно ввести отчёт вручную.";
}
export function startDictation(rec: Recognition, callbacks: { text(text: string): void; error(text: string): void; end(): void }) {
  cancelCurrent?.();
  let ended = false;
  const seen = new Set<number>();
  let timeout: ReturnType<typeof setTimeout>;
  function finish() {
    if (ended) return;
    ended = true; clearTimeout(timeout); clearTimeout(stopTimeout);
    rec.onresult = null; rec.onerror = null; rec.onend = null;
    if (cancelCurrent === cancel) cancelCurrent = undefined;
    callbacks.end();
  }
  function cancel() { finish(); try { rec.abort(); } catch { /* Already stopped. */ } }
  let stopTimeout: ReturnType<typeof setTimeout>;
  function stop() {
    if (ended) return;
    clearTimeout(timeout);
    clearTimeout(stopTimeout);
    // Give the browser time to deliver its final result, never submit interim text.
    stopTimeout = setTimeout(cancel, 3000);
    try { rec.stop(); } catch { cancel(); }
  }
  rec.lang = "ru-RU"; rec.continuous = true; rec.interimResults = false;
  rec.onresult = event => {
    if (ended) return;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (!event.results[i].isFinal || seen.has(i)) continue;
      seen.add(i); const text = event.results[i][0].transcript.trim();
      if (text) callbacks.text(text);
    }
  };
  rec.onerror = event => { if (ended) return; if (event.error !== "aborted") callbacks.error(dictationError(event.error)); cancel(); };
  rec.onend = finish;
  cancelCurrent = cancel;
  timeout = setTimeout(stop, 60000);
  try { rec.start(); } catch { callbacks.error("Не удалось включить микрофон. Повторите попытку или введите текст вручную."); cancel(); }
  return { stop, cancel };
}
