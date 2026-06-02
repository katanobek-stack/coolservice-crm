import type { ReactNode } from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, onClose, children }: ModalProps) {
  return (
    <div
      className="crm-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="crm-modal">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.2px" }}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: 28, height: 28,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "var(--bg3)", border: "1px solid var(--border)",
              borderRadius: 8, cursor: "pointer", color: "var(--text2)",
              fontSize: 16, fontWeight: 600,
            }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
