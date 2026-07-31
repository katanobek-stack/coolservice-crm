export function fmtDate(d?: string | null): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function fmtDayMonth(d?: string | null): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function fmtDateTime(d?: string | null): string {
  if (!d) return "";
  return (
    new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) +
    ", " +
    new Date(d).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  );
}

export function fmtMoney(n: number | string | undefined): string {
  const val = parseFloat(String(n ?? 0)) || 0;
  return Math.round(val).toLocaleString("ru-RU") + " ₽";
}

export function daysAgo(d?: string | null): number {
  if (!d) return 0;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

export function relTime(d?: string | null): string {
  if (!d) return "";
  const n = daysAgo(d);
  if (n === 0) return "сегодня";
  if (n === 1) return "вчера";
  if (n < 7) return `${n} дн. назад`;
  if (n < 30) {
    const w = Math.floor(n / 7);
    return w === 1 ? "нед. назад" : `${w} нед. назад`;
  }
  if (n < 365) {
    const m = Math.floor(n / 30);
    return m === 1 ? "мес. назад" : `${m} мес. назад`;
  }
  const y = Math.floor(n / 365);
  return y === 1 ? "год назад" : `${y} лет назад`;
}

export function genId(): string {
  return "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function parseNum(v: unknown): number {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}
