import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/utils";
import {
  type TaskRequestStatus,
  getTaskRequestStatusMeta,
} from "../lib/request-status";

interface TaskRequestStatusBadgeProps {
  status: TaskRequestStatus;
  className?: string;
  label?: string;
}

export function TaskRequestStatusBadge({
  status,
  className,
  label,
}: TaskRequestStatusBadgeProps) {
  const meta = getTaskRequestStatusMeta(status);
  const isRunning = status === "running";

  return (
    <Badge
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
        meta.className,
        className
      )}
    >
      {isRunning ? (
        <span className="relative inline-flex h-2 w-2 shrink-0">
          <span className="absolute inset-0 rounded-full bg-current opacity-35 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
        </span>
      ) : null}
      {label ?? meta.label}
    </Badge>
  );
}
