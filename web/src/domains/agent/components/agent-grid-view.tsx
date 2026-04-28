import type { RuntimeKind } from "../types";
import { LayoutGrid, List } from "lucide-react";

import { AgentCard } from "./agent-card";
import { AgentListItem } from "./agent-list-item";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group";

export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  color: string | null;
  lifecycle: "active" | "archived";
  defaultRuntime: RuntimeKind;
  sandboxPolicy: string;
  approvalPolicy: string;
}

export type ViewMode = "card" | "list";

export function AgentViewModeToggle({
  viewMode,
  onViewModeChange,
}: {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}) {
  return (
    <ToggleGroup
      value={[viewMode]}
      onValueChange={(value) => {
        if (value.length) onViewModeChange(value[value.length - 1] as ViewMode);
      }}
      variant="outline"
      size="sm"
    >
      <ToggleGroupItem value="card" aria-label="카드 뷰">
        <LayoutGrid size={14} />
      </ToggleGroupItem>
      <ToggleGroupItem value="list" aria-label="리스트 뷰">
        <List size={14} />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

export function AgentGridView({
  agents,
  viewMode,
}: {
  agents: AgentSummary[];
  viewMode: ViewMode;
}) {
  return (
    <>
      {viewMode === "card" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map((agent) => (
            <AgentListItem key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </>
  );
}
