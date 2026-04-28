import type { LucideIcon } from "lucide-react";
import { Archive } from "lucide-react";

export function ArchiveEmpty({
  title = "보관된 항목이 없습니다.",
  description,
  icon,
}: {
  title?: string;
  description?: string;
  icon?: LucideIcon;
}) {
  const Icon = icon ?? Archive;
  return (
    <div className="rounded-2xl border border-dashed bg-muted/30 px-4 py-16 text-center">
      <div className="mx-auto flex size-10 items-center justify-center rounded-xl bg-background text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <h3 className="mt-3 text-sm font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
