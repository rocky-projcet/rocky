import { cn } from "@/shared/lib/utils";

const SIZE_CLASS: Record<NonNullable<AgentAvatarProps["size"]>, string> = {
  sm: "size-7 text-base",
  md: "size-10 text-xl",
  lg: "size-14 text-2xl",
  xl: "size-20 text-4xl",
};

interface AgentAvatarProps {
  emoji: string;
  color?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

export function AgentAvatar({ emoji, color, size = "md", className }: AgentAvatarProps) {
  const tinted = color
    ? {
        backgroundColor: `color-mix(in srgb, ${color} 18%, var(--card))`,
        borderColor: `color-mix(in srgb, ${color} 40%, var(--border))`,
      }
    : undefined;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-2xl border leading-none shadow-sm",
        color ? "border" : "border-border/60 bg-muted/60",
        SIZE_CLASS[size],
        className,
      )}
      style={tinted}
      aria-hidden="true"
    >
      <span className="block translate-y-px">{emoji}</span>
    </span>
  );
}
