import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentEngineClient } from "@/shared/lib/api-client";

import type {
  RockyChatCreateInput,
  RockyChatRecord,
  RockyCoreSettingsUpdateInput,
} from "@/domains/rocky/types";

export const rockyQueryKeys = {
  abilities: ["rocky-abilities"] as const,
  chats: ["rocky-chats"] as const,
  chat: (chatId: string) => ["rocky-chat", chatId] as const,
  coreManagement: ["rocky-core-management"] as const,
};

async function invalidateRockyCore(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: rockyQueryKeys.coreManagement }),
    queryClient.invalidateQueries({ queryKey: rockyQueryKeys.chats }),
  ]);
}

export function useRockyChatsQuery() {
  return useQuery({
    queryKey: rockyQueryKeys.chats,
    queryFn: () => agentEngineClient.listRockyChats(),
  });
}

export function useRockyAbilitiesQuery() {
  return useQuery({
    queryKey: rockyQueryKeys.abilities,
    queryFn: () => agentEngineClient.listRockyAbilities(),
    staleTime: 60_000,
  });
}

export function useRockyCoreManagementQuery() {
  return useQuery({
    queryKey: rockyQueryKeys.coreManagement,
    queryFn: () => agentEngineClient.getRockyCoreManagement(),
  });
}

export function useUpdateRockyCoreSettingsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: RockyCoreSettingsUpdateInput) =>
      agentEngineClient.updateRockyCoreSettings(input),
    onSuccess: async (management) => {
      queryClient.setQueryData(rockyQueryKeys.coreManagement, management);
      await invalidateRockyCore(queryClient);
    },
  });
}

export function useSyncRockyCoreSkillsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => agentEngineClient.syncRockyCoreSkills(),
    onSuccess: async (management) => {
      queryClient.setQueryData(rockyQueryKeys.coreManagement, management);
      await invalidateRockyCore(queryClient);
    },
  });
}

export function useRockyChatQuery(chatId: string | null) {
  return useQuery({
    queryKey: rockyQueryKeys.chat(chatId ?? "new"),
    queryFn: () => agentEngineClient.getRockyChat(chatId!),
    enabled: Boolean(chatId),
  });
}

export function useCreateRockyChatMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: RockyChatCreateInput) =>
      agentEngineClient.createRockyChat(input),
    onSuccess: async (chat: RockyChatRecord) => {
      queryClient.setQueryData(rockyQueryKeys.chat(chat.id), chat);
      await queryClient.invalidateQueries({ queryKey: rockyQueryKeys.chats });
    },
  });
}

export function useStartRockyAbilityGuideMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (abilityId: string) =>
      agentEngineClient.startRockyAbilityGuide(abilityId),
    onSuccess: async (chat: RockyChatRecord) => {
      queryClient.setQueryData(rockyQueryKeys.chat(chat.id), chat);
      await queryClient.invalidateQueries({ queryKey: rockyQueryKeys.chats });
    },
  });
}

export function useSendRockyMessageMutation(chatId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: RockyChatCreateInput) => {
      if (!chatId) {
        throw new Error("Rocky chat id is required.");
      }

      return agentEngineClient.sendRockyChatMessage(chatId, input);
    },
    onSuccess: async (chat: RockyChatRecord) => {
      queryClient.setQueryData(rockyQueryKeys.chat(chat.id), chat);
      await queryClient.invalidateQueries({ queryKey: rockyQueryKeys.chats });
    },
  });
}

export function useCancelRockyChatMutation(chatId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!chatId) {
        throw new Error("Rocky chat id is required.");
      }

      return agentEngineClient.cancelRockyChat(chatId);
    },
    onSuccess: async (chat: RockyChatRecord) => {
      queryClient.setQueryData(rockyQueryKeys.chat(chat.id), chat);
      await invalidateRockyCore(queryClient);
    },
  });
}

export function useDeleteRockyChatMutation(chatId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (inputChatId?: string) => {
      const targetChatId = inputChatId ?? chatId;
      if (!targetChatId) {
        throw new Error("Rocky chat id is required.");
      }

      await agentEngineClient.deleteRockyChat(targetChatId);
      return targetChatId;
    },
    onSuccess: async (deletedChatId) => {
      queryClient.removeQueries({ queryKey: rockyQueryKeys.chat(deletedChatId) });
      await queryClient.invalidateQueries({ queryKey: rockyQueryKeys.chats });
    },
  });
}
