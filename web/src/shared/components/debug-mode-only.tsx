import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bug, Home } from "lucide-react";

import { useAppMode } from "@/shared/lib/app-mode";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

export function DebugModeOnly(props: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { mode, setMode } = useAppMode();

  if (mode === "debug") {
    return <>{props.children}</>;
  }

  return (
    <div className="flex min-h-full items-center justify-center">
      <Card className="max-w-xl gap-0 bg-muted/80 px-8 py-10 text-center">
        <p className="text-xs font-medium uppercase text-muted-foreground">일반 모드</p>
        <h3 className="mt-4 text-xl font-semibold text-foreground">{props.title}</h3>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">{props.description}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setMode("debug")}>
            <Bug className="size-4" />
            디버그 모드로 보기
          </Button>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/" />}>
            <Home className="size-4" />
            홈으로
          </Button>
        </div>
      </Card>
    </div>
  );
}
