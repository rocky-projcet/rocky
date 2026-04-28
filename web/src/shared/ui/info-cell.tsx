import { cn } from "@/lib/utils";

interface InfoCellProps {
  label: string;
  value: string;
  className?: string;
}

function InfoCell({ label, value, className }: InfoCellProps) {
  return (
    <div className={cn("rounded-2xl bg-muted px-3 py-3", className)}>
      <div className="text-xs uppercase -wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 font-medium text-foreground">{value}</div>
    </div>
  );
}

export { InfoCell };
export type { InfoCellProps };
