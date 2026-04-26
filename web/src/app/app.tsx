import { RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/shared/ui/sonner";

import { router } from "./router";
import { queryClient } from "./query-client";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { AppModeProvider } from "@/shared/lib/app-mode";

export function AgentEngineApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppModeProvider>
          <RouterProvider router={router} />
          <Toaster position="bottom-right" richColors />
        </AppModeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
