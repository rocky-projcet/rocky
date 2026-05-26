import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentEngineClient } from "@/shared/lib/api-client";
import type {
  ConnectorProvider,
  ConnectorState,
  ConnectorTesterRequestInput,
} from "@/shared/lib/agent-engine-client";

const STATE_KEY = (provider: ConnectorProvider) =>
  ["connector", provider] as const;
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
