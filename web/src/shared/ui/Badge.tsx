import type { ReactNode } from "react";

type BadgeVariant = "blue" | "green" | "amber" | "red" | "gray" | "cyan" | "purple";

const COLORS: Record<BadgeVariant, { bg: string; color: string }> = {
  blue:   { bg: "rgba(59,130,246,0.1)",   color: "#1d4ed8" },
  green:  { bg: "rgba(22,163,74,0.1)",    color: "#15803d" },
  amber:  { bg: "rgba(217,119,6,0.1)",    color: "#b45309" },
  red:    { bg: "rgba(220,38,38,0.1)",    color: "#dc2626" },
  gray:   { bg: "rgba(0,0,0,0.05)",       color: "var(--text3)" },
  cyan:   { bg: "rgba(8,145,178,0.1)",    color: "#0e7490" },
  purple: { bg: "rgba(124,58,237,0.1)",   color: "#6d28d9" },
};

export function Badge({ children, variant = "gray" }: { children: ReactNode; variant?: BadgeVariant }) {
  const { bg, color } = COLORS[variant];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 10px", borderRadius: 20,
      fontSize: 13, fontWeight: 600,
      background: bg, color,
      whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}
