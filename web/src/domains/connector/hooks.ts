import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentEngineClient } from "@/shared/lib/api-client";
import type {
  ConnectorOAuthSettingsInput,
  ConnectorProvider,
  ConnectorState,
  ConnectorTesterRequestInput,
} from "@/shared/lib/agent-engine-client";

const STATE_KEY = (provider: ConnectorProvider) =>
  ["connector", provider] as const;
const OAUTH_SETTINGS_KEY = (provider: ConnectorProvider) =>
  ["connector", provider, "oauth-settings"] as const;
const DIAGNOSTICS_KEY = ["connector-diagnostics"] as const;

export function useConnectorDiagnosticsQuery(enabled = true) {
  return useQuery({
    queryKey: DIAGNOSTICS_KEY,
    queryFn: () => agentEngineClient.getConnectorDiagnostics(),
    enabled,
    staleTime: 30_000,
  });
}

export function useConnectorStateQuery(provider: ConnectorProvider) {
  return useQuery({
    queryKey: STATE_KEY(provider),
    queryFn: () => agentEngineClient.getConnectorState(provider),
    refetchInterval: (query) => {
      const state = query.state.data as ConnectorState | undefined;
      if (!state) return 1500;
      if (state.status !== "connecting") return false;
      return state.loginMode === "external-browser" ? false : 1500;
    },
    refetchIntervalInBackground: false,
  });
}

export function useConnectorOAuthSettingsQuery(provider: ConnectorProvider) {
  return useQuery({
    queryKey: OAUTH_SETTINGS_KEY(provider),
    queryFn: () => agentEngineClient.getConnectorOAuthSettings(provider),
    enabled: provider === "instagram",
  });
}

export function useConnectorOAuthSettingsMutation(provider: ConnectorProvider) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ConnectorOAuthSettingsInput) =>
      agentEngineClient.saveConnectorOAuthSettings(provider, input),
    onSuccess: (settings) => {
      queryClient.setQueryData(OAUTH_SETTINGS_KEY(provider), settings);
      void queryClient.invalidateQueries({ queryKey: STATE_KEY(provider) });
    },
  });
}

export function useConnectorOAuthSettingsDeleteMutation(provider: ConnectorProvider) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => agentEngineClient.deleteConnectorOAuthSettings(provider),
    onSuccess: (settings) => {
      queryClient.setQueryData(OAUTH_SETTINGS_KEY(provider), settings);
      void queryClient.invalidateQueries({ queryKey: STATE_KEY(provider) });
    },
  });
}

export function useConnectorLoginMutation(provider: ConnectorProvider) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => agentEngineClient.startConnectorLogin(provider),
    onSuccess: (state) => {
      queryClient.setQueryData(STATE_KEY(provider), state);
    },
  });
}

export function useConnectorGraphDiscoveryMutation(provider: ConnectorProvider) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      agentEngineClient.startConnectorGraphDiscovery(provider, {
        openExternal: false,
      }),
    onSuccess: (state) => {
      queryClient.setQueryData(STATE_KEY(provider), state);
    },
  });
}

export function useConnectorTesterRequestMutation(provider: ConnectorProvider) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ConnectorTesterRequestInput) =>
      agentEngineClient.requestConnectorTesterRegistration(provider, input),
    onSuccess: (state) => {
      queryClient.setQueryData(STATE_KEY(provider), state);
    },
  });
}

export function useConnectorCancelMutation(provider: ConnectorProvider) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => agentEngineClient.cancelConnectorLogin(provider),
    onSuccess: (state) => {
      queryClient.setQueryData(STATE_KEY(provider), state);
    },
  });
}

export function useConnectorDisconnectMutation(provider: ConnectorProvider) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => agentEngineClient.disconnectConnector(provider),
    onSuccess: (state) => {
      queryClient.setQueryData(STATE_KEY(provider), state);
    },
  });
}
