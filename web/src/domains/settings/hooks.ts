import { useQuery } from "@tanstack/react-query";

import { agentEngineClient } from "@/shared/lib/api-client";

export const settingsQueryKeys = {
  hardwareStatus: () => ["hardware-status"] as const,
};

export function useHardwareStatusQuery(enabled = true) {
  return useQuery({
    queryKey: settingsQueryKeys.hardwareStatus(),
    queryFn: ({ signal }) => agentEngineClient.getHardwareStatus(signal),
    enabled,
    refetchInterval: enabled ? 10_000 : false,
    refetchIntervalInBackground: true,
  });
}
