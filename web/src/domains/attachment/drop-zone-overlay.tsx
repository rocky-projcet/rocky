import { Upload } from "lucide-react";

import { cn } from "@/shared/lib/utils";

export function DropZoneOverlay({
  visible,
  label = "여기에 파일을 떨어뜨려 첨부해요",
  className,
}: {
  visible: boolean;
  label?: string;
  className?: string;
}) {
  if (!visible) return null;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-foreground/40 bg-background/85 backdrop-blur-sm",
        "animate-in fade-in duration-150",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-2 text-foreground">
        <Upload className="size-8" />
        <p className="text-sm font-medium">{label}</p>
      </div>
    </div>
  );
}
