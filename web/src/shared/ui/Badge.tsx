import type { ReactNode } from "react";

type BadgeVariant = "blue" | "green" | "amber" | "red" | "gray" | "cyan" | "purple";

const COLORS: Record<BadgeVariant, { bg: string; color: string }> = {
  blue:   { bg: "rgba(59,130,246,0.12)",  color: "#60a5fa" },
  green:  { bg: "rgba(34,197,94,0.12)",   color: "#4ade80" },
  amber:  { bg: "rgba(245,158,11,0.12)",  color: "#fbbf24" },
  red:    { bg: "rgba(239,68,68,0.12)",   color: "#f87171" },
  gray:   { bg: "rgba(255,255,255,0.07)", color: "var(--text3)" },
  cyan:   { bg: "rgba(6,182,212,0.12)",   color: "#22d3ee" },
  purple: { bg: "rgba(139,92,246,0.12)",  color: "#a78bfa" },
};

export function Badge({ children, variant = "gray" }: { children: ReactNode; variant?: BadgeVariant }) {
  const { bg, color } = COLORS[variant];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 10px", borderRadius: 20,
      fontSize: 11.5, fontWeight: 600,
      background: bg, color,
      whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}
