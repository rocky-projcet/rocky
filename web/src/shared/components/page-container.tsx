import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

export function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-6xl flex-col gap-6 px-8 pb-8 md:px-10 md:pb-10",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  belowSlot,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  belowSlot?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-20 -mx-8 flex flex-col gap-4 bg-background px-8 pb-4 pt-8 md:-mx-10 md:px-10 md:pb-5 md:pt-10",
        className,
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-normal text-foreground">{title}</h1>
          {description ? (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {belowSlot}
    </header>
  );
}
