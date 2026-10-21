import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentEngineClient } from "@/shared/lib/api-client";
import type { AppUpdateRecord } from "@/shared/lib/agent-engine-client";

export const appUpdateQueryKeys = {
  appUpdate: ["rocky-app-update"] as const,
};

export function useRockyAppUpdateQuery() {
  return useQuery({
    queryKey: appUpdateQueryKeys.appUpdate,
    queryFn: () => agentEngineClient.getRockyAppUpdate(),
    refetchInterval: (query) => {
      const status = (query.state.data as AppUpdateRecord | undefined)?.status;
      return status === "downloading" ||
        status === "checking" ||
        status === "installing"
        ? 250
        : false;
    },
    refetchIntervalInBackground: true,
  });
}

function setAppUpdateData(
  queryClient: ReturnType<typeof useQueryClient>,
  record: AppUpdateRecord
) {
  queryClient.setQueryData(appUpdateQueryKeys.appUpdate, record);
}

export function useCheckRockyAppUpdateMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => agentEngineClient.checkRockyAppUpdate(),
    onSuccess: (record) => {
      setAppUpdateData(queryClient, record);
    },
  });
}

export function useDownloadRockyAppUpdateMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => agentEngineClient.downloadRockyAppUpdateInstaller(),
    onSuccess: (record) => {
      setAppUpdateData(queryClient, record);
    },
  });
}

export function useStartRockyAppUpdateInstallerMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => agentEngineClient.startRockyAppUpdateInstaller(),
    onSuccess: (record) => {
      setAppUpdateData(queryClient, record);
    },
  });
}

export function useRevealRockyAppUpdateInstallerMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => agentEngineClient.revealRockyAppUpdateInstaller(),
    onSuccess: (record) => {
      setAppUpdateData(queryClient, record);
    },
  });
}
