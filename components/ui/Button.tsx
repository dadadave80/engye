"use client";
// ENGYE button — animate-ui swap: the animate-ui button pattern (cva variants + motion.button
// press/hover primitive), remapped from Tailwind's default palette to ENGYE tokens (wired into
// @theme in globals.css). Keeps ENGYE's variant/size vocabulary so the 9 call-sites don't churn,
// and its ≥44px `md` touch target. Scale interaction is subtle (not the library's 1.05/0.95) and
// respects prefers-reduced-motion via <MotionConfig reducedMotion="user"> in WalletProvider.
import { type CSSProperties, type ReactNode } from "react";
import { motion } from "motion/react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-sans font-medium leading-none select-none cursor-pointer outline-none transition-colors [&_svg]:shrink-0 [&_svg]:pointer-events-none disabled:opacity-55 disabled:cursor-not-allowed disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline: "border border-border bg-transparent text-foreground hover:bg-foreground/[0.06]",
        ghost: "bg-transparent text-foreground hover:bg-foreground/[0.06]",
        accent: "bg-accent text-accent-foreground hover:bg-accent/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      },
      size: {
        sm: "min-h-8 px-3.5 text-[13px] gap-1.5",
        md: "min-h-11 px-5 text-sm", // ≥44px touch target
        lg: "min-h-[52px] px-7 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type Variant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
type Size = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

export function Button({
  variant = "primary", size = "md", disabled = false, children, onClick, style, type = "button", className,
}: {
  variant?: Variant; size?: Size; disabled?: boolean; children: ReactNode;
  onClick?: () => void; style?: CSSProperties; type?: "button" | "submit"; className?: string;
}) {
  return (
    <motion.button
      type={type} disabled={disabled} onClick={onClick}
      className={cn(buttonVariants({ variant, size }), "focus-ring", className)}
      whileHover={disabled ? undefined : { scale: 1.02 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      style={style}
    >
      {children}
    </motion.button>
  );
}

export { buttonVariants };
