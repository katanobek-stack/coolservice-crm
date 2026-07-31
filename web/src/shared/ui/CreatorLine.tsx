import type { CSSProperties } from "react";
import { fmtDayMonth } from "../utils/format";

// Unobtrusive "Создал: Иван · 10 июня" line shown under a repair or task title
export function CreatorLine({ name, date, style }: {
  name?:  string;
  date?:  string;
  style?: CSSProperties;
}) {
  if (!name) return null;
  return (
    <div style={{ fontSize: 10.5, color: "var(--text3)", opacity: 0.7, ...style }}>
      🖊 Создал: {name}{date ? ` · ${fmtDayMonth(date)}` : ""}
    </div>
  );
}
