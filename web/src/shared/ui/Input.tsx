import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, CSSProperties, ReactNode } from "react";

const BASE: CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid var(--border2)",
  background: "var(--bg3)",
  color: "var(--text)",
  fontSize: 13.5,
  fontFamily: "Manrope, sans-serif",
  outline: "none",
  transition: "border-color 0.18s",
  minHeight: 44,
};

export function Input({ style, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      style={{ ...BASE, ...style }}
      onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
      onBlur={(e)  => { e.currentTarget.style.borderColor = "var(--border2)"; }}
      {...props}
    />
  );
}

export function Textarea({ style, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      style={{ ...BASE, minHeight: 80, resize: "vertical", ...style }}
      onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
      onBlur={(e)  => { e.currentTarget.style.borderColor = "var(--border2)"; }}
      {...props}
    />
  );
}

export function Select({
  children, style, ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children?: ReactNode }) {
  return (
    <select
      style={{ ...BASE, cursor: "pointer", ...style }}
      onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
      onBlur={(e)  => { e.currentTarget.style.borderColor = "var(--border2)"; }}
      {...props}
    >
      {children}
    </select>
  );
}

export function FormGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{
        display: "block", fontSize: 11, fontWeight: 600,
        color: "var(--text3)", textTransform: "uppercase",
        letterSpacing: "0.5px", marginBottom: 6,
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}
