import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { agentEngineClient } from "@/shared/lib/api-client";
import type {
  AgentCreateInput,
  AgentUpdateInput,
} from "@/domains/agent/types";

export const agentQueryKeys = {
  agents: (includeArchived = false) =>
    ["agents", includeArchived ? "all" : "active"] as const,
  agent: (agentId: string) => ["agent", agentId] as const,
  workspaceDirectory: (agentId: string, searchPath: string) =>
    ["agent-workspace-directory", agentId, searchPath] as const,
  workspaceFile: (agentId: string, searchPath: string) =>
    ["agent-workspace-file", agentId, searchPath] as const,
};

export function useAgentsQuery(
  options: {
    includeArchived?: boolean;
  } = {}
) {
  return useQuery({
    queryKey: agentQueryKeys.agents(options.includeArchived ?? false),
    queryFn: () =>
      agentEngineClient.listAgents({
        includeArchived: options.includeArchived ?? false,
      }),
  });
}

export function useAgentQuery(agentId: string | undefined) {
  return useQuery({
    queryKey: agentQueryKeys.agent(agentId ?? "unknown"),
    queryFn: () => agentEngineClient.getAgent(agentId!),
    enabled: Boolean(agentId),
  });
}

export function useCreateAgentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AgentCreateInput) => agentEngineClient.createAgent(input),
    onSuccess: async (created) => {
      queryClient.setQueryData(agentQueryKeys.agent(created.id), created);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentQueryKeys.agents(false),
        }),
        queryClient.invalidateQueries({
          queryKey: agentQueryKeys.agents(true),
        }),
      ]);
    },
  });
}

export function useUpdateAgentMutation(agentId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AgentUpdateInput) => {
      if (!agentId) {
        throw new Error("Agent id is required to update an agent.");
      }

      return agentEngineClient.updateAgent(agentId, input);
    },
    onSuccess: async (updated) => {
      queryClient.setQueryData(agentQueryKeys.agent(updated.id), updated);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentQueryKeys.agents(false),
        }),
        queryClient.invalidateQueries({
          queryKey: agentQueryKeys.agents(true),
        }),
      ]);
    },
  });
}

export function useDeleteAgentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { agentId: string }) => {
      await agentEngineClient.deleteAgent(input.agentId);
      return input.agentId;
    },
    onSuccess: async (agentId) => {
      queryClient.removeQueries({
        queryKey: agentQueryKeys.agent(agentId),
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentQueryKeys.agents(false),
        }),
        queryClient.invalidateQueries({
          queryKey: agentQueryKeys.agents(true),
        }),
      ]);
    },
  });
}

export function useAgentWorkspaceDirectoryQuery(
  agentId: string | undefined,
  searchPath = ""
) {
  return useQuery({
    queryKey: agentQueryKeys.workspaceDirectory(agentId ?? "unknown", searchPath),
    queryFn: () => agentEngineClient.listAgentWorkspace(agentId!, searchPath),
    enabled: Boolean(agentId),
  });
}

export function useAgentWorkspaceFilePreviewQuery(
  agentId: string | undefined,
  searchPath: string | null | undefined
) {
  return useQuery({
    queryKey: agentQueryKeys.workspaceFile(agentId ?? "unknown", searchPath ?? ""),
    queryFn: () => agentEngineClient.getAgentWorkspaceFilePreview(agentId!, searchPath!),
    enabled: Boolean(agentId) && Boolean(searchPath),
  });
}
