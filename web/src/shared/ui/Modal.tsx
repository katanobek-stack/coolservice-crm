import type { ReactNode } from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, onClose, children }: ModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(15,23,42,.38)", backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-[560px] rounded-t-[28px] overflow-y-auto"
        style={{
          background: "#fff",
          maxHeight: "90vh",
          padding: "20px 18px 40px",
          boxShadow: "0 -20px 60px rgba(15,23,42,.20)",
          border: "1px solid #E2E8F0",
          borderBottom: "none",
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[#172033]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-2xl text-[#8A96A8] leading-none cursor-pointer bg-transparent border-none"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
