import type { ReactNode } from "react";

type BadgeVariant = "blue" | "green" | "amber" | "red" | "gray" | "cyan";

const COLORS: Record<BadgeVariant, string> = {
  blue:  "bg-[#E6F1FB] text-[#0C447C]",
  green: "bg-[#EAF3DE] text-[#27500A]",
  amber: "bg-[#FAEEDA] text-[#854F0B]",
  red:   "bg-[#FBEAEA] text-[#A32D2D]",
  gray:  "bg-[#F2F4F7] text-[#667085]",
  cyan:  "bg-cyan-50 text-cyan-700",
};

export function Badge({ children, variant = "gray" }: { children: ReactNode; variant?: BadgeVariant }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${COLORS[variant]}`}>
      {children}
    </span>
  );
}
