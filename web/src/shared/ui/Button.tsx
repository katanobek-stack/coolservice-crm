import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}

const VARIANT_STYLES: Record<string, CSSProperties> = {
  primary:   { background: "var(--accent)",                color: "white" },
  secondary: { background: "rgba(59,130,246,0.12)",        color: "var(--accent2)" },
  danger:    { background: "rgba(239,68,68,0.12)",         color: "#f87171" },
  ghost:     { background: "var(--bg3)",                   color: "var(--text2)", border: "1px solid var(--border)" },
};

const SIZE_STYLES: Record<string, CSSProperties> = {
  sm: { padding: "5px 12px",  fontSize: 12, borderRadius: 8 },
  md: { padding: "7px 14px",  fontSize: 13, borderRadius: 8 },
  lg: { padding: "10px 16px", fontSize: 14, borderRadius: 10, width: "100%" },
};

export function Button({ variant = "primary", size = "md", style, children, ...props }: ButtonProps) {
  return (
    <button
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        fontFamily: "Manrope, sans-serif", fontWeight: 600,
        cursor: "pointer", border: "none", transition: "all 0.18s",
        ...VARIANT_STYLES[variant],
        ...SIZE_STYLES[size],
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
}
