import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";

const BASE = "w-full px-3.5 py-3 rounded-[14px] border border-[#E2E8F0] bg-white text-[#172033] text-base placeholder-[#98A2B3] outline-none transition-all focus:border-[#7CB7EA] focus:shadow-[0_0_0_4px_rgba(24,95,165,.10)]";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${BASE} min-h-[46px]`} {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${BASE} min-h-[80px] resize-y`} {...props} />;
}

export function Select({
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${BASE} min-h-[46px] cursor-pointer`} {...props}>
      {children}
    </select>
  );
}

export function FormGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3.5">
      <label className="block text-xs font-semibold text-[#667085] mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  );
}
