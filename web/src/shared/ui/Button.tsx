import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}

const VARIANTS = {
  primary:   "bg-[#185FA5] hover:bg-[#1a6db8] text-white shadow-[0_4px_14px_rgba(24,95,165,.25)]",
  secondary: "bg-[#E6F1FB] text-[#185FA5] hover:bg-[#d4e8f9]",
  danger:    "bg-[#FBEAEA] text-[#A32D2D] hover:bg-red-100",
  ghost:     "bg-transparent text-[#667085] hover:bg-gray-100",
};

const SIZES = {
  sm: "px-3 py-1.5 text-sm rounded-xl",
  md: "px-4 py-3 text-base rounded-[14px]",
  lg: "w-full px-4 py-3.5 text-base rounded-[15px]",
};

export function Button({ variant = "primary", size = "md", className = "", children, ...props }: ButtonProps) {
  return (
    <button
      className={`font-semibold cursor-pointer border-none transition-all active:scale-[.97] ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
