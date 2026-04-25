import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentEngineClient } from "@/shared/lib/api-client";

import type {
  RockyChatCreateInput,
  RockyChatRecord,
} from "@/domains/rocky/types";

export const rockyQueryKeys = {
  chats: ["rocky-chats"] as const,
  chat: (chatId: string) => ["rocky-chat", chatId] as const,
};

export function useRockyChatsQuery() {
  return useQuery({
    queryKey: rockyQueryKeys.chats,
    queryFn: () => agentEngineClient.listRockyChats(),
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
