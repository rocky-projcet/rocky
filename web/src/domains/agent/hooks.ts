import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { agentEngineClient } from "@/shared/lib/api-client";
import type {
  AgentCreateInput,
  AgentLocalSkillFileInput,
  AgentUpdateInput,
  AuthProfileCreateInput,
  AuthProfileUpdateInput,
} from "@/domains/agent/types";

export const agentQueryKeys = {
  agents: (includeArchived = false) =>
    ["agents", includeArchived ? "all" : "active"] as const,
  agent: (agentId: string) => ["agent", agentId] as const,
  agentLocalSkills: (agentId: string) => ["agent-local-skills", agentId] as const,
  workspaceDirectory: (agentId: string, searchPath: string) =>
    ["agent-workspace-directory", agentId, searchPath] as const,
  workspaceFile: (agentId: string, searchPath: string) =>
    ["agent-workspace-file", agentId, searchPath] as const,
  authProfiles: (includeArchived = false) =>
    ["auth-profiles", includeArchived ? "all" : "active"] as const,
  authProfile: (authProfileId: string) =>
    ["auth-profile", authProfileId] as const,
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

export function useAgentLocalSkillsQuery(agentId: string | undefined) {
  return useQuery({
    queryKey: agentQueryKeys.agentLocalSkills(agentId ?? "unknown"),
    queryFn: () => agentEngineClient.listAgentLocalSkills(agentId!),
    enabled: Boolean(agentId),
  });
}

export function useUpsertAgentLocalSkillMutation(agentId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      skillId: string;
      replace?: boolean;
      files: AgentLocalSkillFileInput[];
    }) => {
      if (!agentId) {
        throw new Error("Agent id is required to install a skill.");
      }

      return agentEngineClient.upsertAgentLocalSkill(agentId, input.skillId, {
        replace: input.replace,
        files: input.files,
      });
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(
        agentQueryKeys.agentLocalSkills(agentId!),
        result.skills,
      );
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

export function useDeleteAgentLocalSkillMutation(agentId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (skillId: string) => {
      if (!agentId) {
        throw new Error("Agent id is required to delete a skill.");
      }

      return agentEngineClient.deleteAgentLocalSkill(agentId, skillId);
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(
        agentQueryKeys.agentLocalSkills(agentId!),
        result.skills,
      );
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
    mutationFn: async (input: {
      agentId: string;
      stopRunningSessions?: boolean;
    }) => {
      await agentEngineClient.deleteAgent(input.agentId, {
        stopRunningSessions: input.stopRunningSessions,
      });
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

export function useAuthProfilesQuery(
  options: {
    includeArchived?: boolean;
  } = {}
) {
  return useQuery({
    queryKey: agentQueryKeys.authProfiles(options.includeArchived ?? false),
    queryFn: () =>
      agentEngineClient.listAuthProfiles({
        includeArchived: options.includeArchived ?? false,
      }),
  });
}

export function useCreateAuthProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AuthProfileCreateInput) =>
      agentEngineClient.createAuthProfile(input),
    onSuccess: async (created) => {
      queryClient.setQueryData(agentQueryKeys.authProfile(created.id), created);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentQueryKeys.authProfiles(false),
        }),
        queryClient.invalidateQueries({
          queryKey: agentQueryKeys.authProfiles(true),
        }),
      ]);
    },
  });
}

export function useUpdateAuthProfileMutation(authProfileId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AuthProfileUpdateInput) => {
      if (!authProfileId) {
        throw new Error("Auth profile id is required to update an auth profile.");
      }

      return agentEngineClient.updateAuthProfile(authProfileId, input);
    },
    onSuccess: async (updated) => {
      queryClient.setQueryData(agentQueryKeys.authProfile(updated.id), updated);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentQueryKeys.authProfiles(false),
        }),
        queryClient.invalidateQueries({
          queryKey: agentQueryKeys.authProfiles(true),
        }),
      ]);
    },
  });
}

export function useDeleteAuthProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (authProfileId: string) => {
      await agentEngineClient.deleteAuthProfile(authProfileId);
      return authProfileId;
    },
    onSuccess: async (authProfileId) => {
      queryClient.removeQueries({
        queryKey: agentQueryKeys.authProfile(authProfileId),
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentQueryKeys.authProfiles(false),
        }),
        queryClient.invalidateQueries({
          queryKey: agentQueryKeys.authProfiles(true),
        }),
        queryClient.invalidateQueries({
          queryKey: ["agent-sessions"],
        }),
      ]);
    },
  });
}
