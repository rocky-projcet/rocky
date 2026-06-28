import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentEngineClient } from "@/shared/lib/api-client";
import type {
  ClaudeAccountRecord,
  ClaudeStatusRecord,
  CodexAccountRecord,
  CodexStatusRecord,
  ProviderAccountsResponse,
  ProviderStatusesResponse,
  RockyAppUpdateRecord,
} from "@/domains/codex/types";

export const codexQueryKeys = {
  providerAccounts: () => ["provider-accounts"] as const,
  providerStatuses: () => ["provider-statuses"] as const,
  hardwareStatus: () => ["hardware-status"] as const,
  rockyAppUpdate: () => ["rocky-app-update"] as const,
  runtimes: () => ["runtime-descriptors"] as const,
  codexAccount: () => ["codex-account"] as const,
  codexStatus: () => ["codex-status"] as const,
  claudeAccount: () => ["claude-account"] as const,
  claudeStatus: () => ["claude-status"] as const,
};

async function invalidateProviderQueries(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: codexQueryKeys.providerAccounts(),
    }),
    queryClient.invalidateQueries({
      queryKey: codexQueryKeys.providerStatuses(),
    }),
    queryClient.invalidateQueries({
      queryKey: codexQueryKeys.codexAccount(),
    }),
    queryClient.invalidateQueries({
      queryKey: codexQueryKeys.codexStatus(),
    }),
    queryClient.invalidateQueries({
      queryKey: codexQueryKeys.claudeAccount(),
    }),
    queryClient.invalidateQueries({
      queryKey: codexQueryKeys.claudeStatus(),
    }),
  ]);
}

export function useProviderAccountsQuery() {
  return useQuery({
    queryKey: codexQueryKeys.providerAccounts(),
    queryFn: ({ signal }) => agentEngineClient.getProviderAccounts(signal),
    refetchInterval: (query) => {
      const data = query.state.data as ProviderAccountsResponse | undefined;
      return data?.providers.some(
        (provider) =>
          provider.status === "pending" || provider.update.status === "pending"
      )
        ? 1500
        : 15000;
    },
    refetchIntervalInBackground: true,
  });
}

export function useProviderStatusesQuery() {
  return useQuery({
    queryKey: codexQueryKeys.providerStatuses(),
    queryFn: ({ signal }) => agentEngineClient.getProviderStatuses(signal),
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });
}

export function useHardwareStatusQuery(enabled = true) {
  return useQuery({
    queryKey: codexQueryKeys.hardwareStatus(),
    queryFn: ({ signal }) => agentEngineClient.getHardwareStatus(signal),
    enabled,
    refetchInterval: enabled ? 10_000 : false,
    refetchIntervalInBackground: true,
  });
}

export function useRockyAppUpdateQuery() {
  return useQuery({
    queryKey: codexQueryKeys.rockyAppUpdate(),
    queryFn: ({ signal }) => agentEngineClient.getRockyAppUpdate(signal),
    refetchInterval: (query) => {
      const data = query.state.data as RockyAppUpdateRecord | undefined;
      return data?.operation.status === "pending" ? 1500 : false;
    },
    refetchIntervalInBackground: true,
  });
}

export function useRuntimesQuery() {
  return useQuery({
    queryKey: codexQueryKeys.runtimes(),
    queryFn: ({ signal }) => agentEngineClient.listRuntimes(signal),
    staleTime: 5 * 60_000,
  });
}

export function useCodexAccountQuery() {
  return useQuery({
    queryKey: codexQueryKeys.codexAccount(),
    queryFn: ({ signal }) => agentEngineClient.getCodexAccount(signal),
    refetchInterval: (query) => {
      const data = query.state.data as CodexAccountRecord | undefined;
      return data?.status === "pending" || data?.update.status === "pending"
        ? 1500
        : false;
    },
    refetchIntervalInBackground: true,
  });
}

export function useCodexStatusQuery() {
  return useQuery({
    queryKey: codexQueryKeys.codexStatus(),
    queryFn: ({ signal }) => agentEngineClient.getCodexStatus(signal),
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });
}

export function useClaudeAccountQuery() {
  return useQuery({
    queryKey: codexQueryKeys.claudeAccount(),
    queryFn: ({ signal }) => agentEngineClient.getClaudeAccount(signal),
    refetchInterval: (query) => {
      const data = query.state.data as ClaudeAccountRecord | undefined;
      return data?.status === "pending" || data?.update.status === "pending"
        ? 1500
        : false;
    },
    refetchIntervalInBackground: true,
  });
}

export function useClaudeStatusQuery() {
  return useQuery({
    queryKey: codexQueryKeys.claudeStatus(),
    queryFn: ({ signal }) => agentEngineClient.getClaudeStatus(signal),
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });
}

export function useStartCodexLoginMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => agentEngineClient.startCodexLogin(),
    onSuccess: async () => {
      await invalidateProviderQueries(queryClient);
    },
  });
}

export function useStartCodexDeviceAuthMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => agentEngineClient.startCodexDeviceAuth(),
    onSuccess: async () => {
      await invalidateProviderQueries(queryClient);
    },
  });
}

export function useLoginCodexApiKeyMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (apiKey: string) => agentEngineClient.loginCodexWithApiKey(apiKey),
    onSuccess: async () => {
      await invalidateProviderQueries(queryClient);
    },
  });
}

export function useLogoutCodexAccountMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => agentEngineClient.logoutCodexAccount(),
    onSuccess: async () => {
      await invalidateProviderQueries(queryClient);
    },
  });
}

export function useStartCodexUpdateMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => agentEngineClient.startCodexUpdate(),
    onSuccess: async () => {
      await invalidateProviderQueries(queryClient);
    },
  });
}

export function useSuggestAgentForSkillMutation() {
  return useMutation({
    mutationFn: async (input: {
      title: string;
      description: string;
      triggerLabel: string;
    }) => agentEngineClient.suggestAgentForSkill(input),
  });
}

export function useStartClaudeLoginMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mode: "claudeai" | "console" = "claudeai") =>
      agentEngineClient.startClaudeLogin(mode),
    onSuccess: async () => {
      await invalidateProviderQueries(queryClient);
    },
  });
}

export function useLogoutClaudeAccountMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => agentEngineClient.logoutClaudeAccount(),
    onSuccess: async () => {
      await invalidateProviderQueries(queryClient);
    },
  });
}

export function useStartClaudeUpdateMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => agentEngineClient.startClaudeUpdate(),
    onSuccess: async () => {
      await invalidateProviderQueries(queryClient);
    },
  });
}

function useRockyAppUpdateMutation(
  mutationFn: () => Promise<RockyAppUpdateRecord>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (state) => {
      queryClient.setQueryData(codexQueryKeys.rockyAppUpdate(), state);
    },
  });
}

export function useCheckRockyAppUpdateMutation() {
  return useRockyAppUpdateMutation(() => agentEngineClient.checkRockyAppUpdate());
}

export function useDownloadRockyAppUpdateMutation() {
  return useRockyAppUpdateMutation(() => agentEngineClient.downloadRockyAppUpdate());
}

export function useInstallRockyAppUpdateMutation() {
  return useRockyAppUpdateMutation(() => agentEngineClient.installRockyAppUpdate());
}

export function useOpenRockyAppUpdateFolderMutation() {
  return useRockyAppUpdateMutation(() =>
    agentEngineClient.openRockyAppUpdateDownloadFolder()
  );
}
