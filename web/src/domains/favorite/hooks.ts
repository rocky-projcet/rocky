import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentEngineClient } from "@/shared/lib/api-client";
import type {
  FavoriteCreateInput,
  FavoriteRecord,
} from "@/shared/lib/agent-engine-client";

const FAVORITES_QUERY_KEY = ["favorites"] as const;

export function useFavoritesQuery() {
  return useQuery({
    queryKey: FAVORITES_QUERY_KEY,
    queryFn: async () => (await agentEngineClient.listFavorites()).favorites,
    staleTime: 30_000,
  });
}

export function useAddFavoriteMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: FavoriteCreateInput) => agentEngineClient.addFavorite(input),
    onSuccess: (record) => {
      queryClient.setQueryData<FavoriteRecord[]>(
        FAVORITES_QUERY_KEY,
        (current) => {
          const list = current ?? [];
          if (list.some((entry) => entry.id === record.id)) return list;
          return [record, ...list];
        },
      );
    },
  });
}

export function useRemoveFavoriteMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => agentEngineClient.removeFavorite(id),
    onSuccess: (result) => {
      queryClient.setQueryData<FavoriteRecord[]>(
        FAVORITES_QUERY_KEY,
        (current) => (current ?? []).filter((entry) => entry.id !== result.id),
      );
    },
  });
}

export function findFavoriteId(
  favorites: FavoriteRecord[] | undefined,
  match: {
    kind: FavoriteRecord["kind"];
    chatId: string;
    runId?: string | null;
    artifactId?: string | null;
    messageId?: string | null;
  },
): string | null {
  if (!favorites) return null;
  const found = favorites.find((entry) => {
    if (entry.kind !== match.kind) return false;
    if (entry.chatId !== match.chatId) return false;
    if (match.kind === "output-file") {
      return entry.runId === match.runId && entry.artifactId === match.artifactId;
    }
    if (match.kind === "agent-message") {
      return entry.messageId === match.messageId;
    }
    return true;
  });
  return found?.id ?? null;
}
