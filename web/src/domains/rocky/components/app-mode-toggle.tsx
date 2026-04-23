import { Bug, Sparkles } from "lucide-react";

import { useAppMode } from "@/shared/lib/app-mode";
import { cn } from "@/shared/lib/utils";

export function AppModeToggle() {
  const { mode, setMode } = useAppMode();

  return (
    <div className="inline-flex items-center gap-1 rounded-full border bg-muted/70 p-1">
      <button
        type="button"
        aria-pressed={mode === "normal"}
        className={cn(
          "inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium transition",
          mode === "normal"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
        onClick={() => setMode("normal")}
      >
        <Sparkles className="size-3.5" />
        일반
      </button>
      <button
        type="button"
        aria-pressed={mode === "debug"}
        className={cn(
          "inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium transition",
          mode === "debug"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
        onClick={() => setMode("debug")}
      >
        <Bug className="size-3.5" />
        디버그
      </button>
    </div>
  );
}
