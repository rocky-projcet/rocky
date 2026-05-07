import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  ListTodo,
  MessageSquare,
  Sparkles,
  Star,
} from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import { toast } from "sonner";

import { useRockyChatsQuery } from "@/domains/rocky/hooks";
import { useAgentsQuery } from "@/domains/agent/hooks";
import { AgentAvatar } from "@/domains/agent/components/agent-avatar";
import { useAgentEmoji } from "@/domains/agent/lib/agent-avatar-store";
import { filterUserManagedAgents } from "@/domains/rocky/lib/rocky-agent-catalog";
import { resolveRockyChatAgentId } from "@/domains/agent/lib/agent-task-summary";
import { readAllTaskAgentMap } from "@/domains/agent/lib/task-agent-store";
import {
  formatRockyTaskDateTime,
  getRockyTaskRequest,
  getRockyTaskStatus,
  getRockyTaskSummary,
  rockyTaskStatusLabel,
  rockyTaskStatusTone,
} from "@/domains/rocky/lib/rocky-task-model";
import {
  buildRecentSavedFiles,
  collectRecentSavedFileRunContexts,
  type RecentSavedFile,
} from "@/domains/rocky/lib/home-recent-files";
import { runQueryKeys } from "@/domains/run/hooks";
import { agentEngineClient } from "@/shared/lib/api-client";
import { PageContainer, PageHeader } from "@/shared/components/page-container";
import { Badge } from "@/shared/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { cn } from "@/shared/lib/utils";
import type {
  AgentRecord,
  FavoriteRecord,
  RockyChatRecord,
  RunArtifactRecord,
} from "@/shared/lib/agent-engine-client";

import { useFavoritesQuery } from "./hooks";
import { FavoriteToggle } from "./favorite-toggle";

type FavoriteTab = "files" | "messages" | "tasks";

export function FavoritesPage() {
  const favoritesQuery = useFavoritesQuery();
  const chatsQuery = useRockyChatsQuery();
  const agentsQuery = useAgentsQuery({ includeArchived: true });
  const [activeTab, setActiveTab] = useState<FavoriteTab>("files");

  const favorites = favoritesQuery.data ?? [];
  const chats = chatsQuery.data ?? [];
  const agents = filterUserManagedAgents(agentsQuery.data ?? []);
  const taskAgentMap = useMemo(() => readAllTaskAgentMap(), []);

  const fileFavorites = useMemo(
    () => favorites.filter((entry) => entry.kind === "output-file"),
    [favorites],
  );
  const messageFavorites = useMemo(
    () => favorites.filter((entry) => entry.kind === "agent-message"),
    [favorites],
  );
  const taskFavorites = useMemo(
    () => favorites.filter((entry) => entry.kind === "task"),
    [favorites],
  );

  const fileChatIds = useMemo(
    () => Array.from(new Set(fileFavorites.map((favorite) => favorite.chatId))),
    [fileFavorites],
  );
  const fileChats = useMemo(
    () => chats.filter((chat) => fileChatIds.includes(chat.id)),
    [chats, fileChatIds],
  );
  const runContexts = useMemo(
    () => collectRecentSavedFileRunContexts(fileChats, 200),
    [fileChats],
  );
  const runArtifactQueries = useQueries({
    queries: runContexts.map((context) => ({
      queryKey: runQueryKeys.runArtifacts(context.runId),
      queryFn: () => agentEngineClient.listRunArtifacts(context.runId),
      staleTime: 60_000,
    })),
  });
  const recentFileMap = useMemo(() => {
    const artifactsByRunId = new Map<string, RunArtifactRecord[]>();
    runContexts.forEach((context, index) => {
      artifactsByRunId.set(context.runId, runArtifactQueries[index]?.data ?? []);
    });
    const records = buildRecentSavedFiles(runContexts, artifactsByRunId, 500);
    const map = new Map<string, RecentSavedFile>();
    for (const file of records) {
      map.set(`${file.runId}::${file.artifact.role}`, file);
    }
    return map;
  }, [runContexts, runArtifactQueries]);

  return (
    <PageContainer>
      <Tabs
        value={activeTab}
        onValueChange={(next) => setActiveTab(next as FavoriteTab)}
        className="gap-4"
      >
        <PageHeader
          title="즐겨찾기"
          description="자주 다시 꺼내보는 결과·답변·작업을 한 곳에 모아요."
          belowSlot={
            <TabsList variant="line">
              <TabsTrigger value="files">
                <FileText className="size-4" />
                결과 파일
                <CountBadge count={fileFavorites.length} />
              </TabsTrigger>
              <TabsTrigger value="messages">
                <MessageSquare className="size-4" />
                답변
                <CountBadge count={messageFavorites.length} />
              </TabsTrigger>
              <TabsTrigger value="tasks">
                <ListTodo className="size-4" />
                작업
                <CountBadge count={taskFavorites.length} />
              </TabsTrigger>
            </TabsList>
          }
        />

        <TabsContent value="files">
          <FavoriteFilesGrid
            favorites={fileFavorites}
            recentFileMap={recentFileMap}
            chats={chats}
            agents={agents}
            taskAgentMap={taskAgentMap}
            loading={favoritesQuery.isLoading || chatsQuery.isLoading}
          />
        </TabsContent>

        <TabsContent value="messages">
          <FavoriteMessagesGrid
            favorites={messageFavorites}
            chats={chats}
            agents={agents}
            taskAgentMap={taskAgentMap}
            loading={favoritesQuery.isLoading || chatsQuery.isLoading}
          />
        </TabsContent>

        <TabsContent value="tasks">
          <FavoriteTasksGrid
            favorites={taskFavorites}
            chats={chats}
            agents={agents}
            taskAgentMap={taskAgentMap}
            loading={favoritesQuery.isLoading || chatsQuery.isLoading}
          />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function CountBadge({ count }: { count: number }) {
  return (
    <Badge
      variant="outline"
      className="ml-1 h-5 border-border bg-muted px-1.5 text-[10px] text-muted-foreground"
    >
      {count}
    </Badge>
  );
}

function EmptyState({ icon: Icon, message }: { icon: typeof Star; message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-muted/30 px-6 py-12 text-center text-sm text-muted-foreground">
      <Icon className="size-6" />
      <p>{message}</p>
    </div>
  );
}

function resolveAgentForChat(
  chatId: string,
  chats: RockyChatRecord[],
  agents: AgentRecord[],
  taskAgentMap: Record<string, string>,
): { chat: RockyChatRecord | undefined; agent: AgentRecord | null } {
  const chat = chats.find((entry) => entry.id === chatId);
  const agentId = chat ? resolveRockyChatAgentId(chat, taskAgentMap) : null;
  const agent = agentId ? agents.find((entry) => entry.id === agentId) ?? null : null;
  return { chat, agent };
}

function FavoriteFilesGrid({
  favorites,
  recentFileMap,
  chats,
  agents,
  taskAgentMap,
  loading,
}: {
  favorites: FavoriteRecord[];
  recentFileMap: Map<string, RecentSavedFile>;
  chats: RockyChatRecord[];
  agents: AgentRecord[];
  taskAgentMap: Record<string, string>;
  loading: boolean;
}) {
  if (loading) {
    return <EmptyState icon={Star} message="불러오는 중입니다." />;
  }
  if (favorites.length === 0) {
    return (
      <EmptyState
        icon={Star}
        message="결과 파일에 별을 누르면 여기에 모입니다."
      />
    );
  }
  return (
    <ul className="grid gap-2">
      {favorites.map((favorite) => {
        const key = `${favorite.runId ?? ""}::${favorite.artifactId ?? ""}`;
        const file = recentFileMap.get(key);
        const { chat, agent } = resolveAgentForChat(
          favorite.chatId,
          chats,
          agents,
          taskAgentMap,
        );
        return (
          <li key={favorite.id}>
            <FavoriteFileCard
              favorite={favorite}
              file={file}
              agent={agent}
              chat={chat}
            />
          </li>
        );
      })}
    </ul>
  );
}

function fileOpenHref(
  file: RecentSavedFile,
  agentId: string | null,
): string {
  if (agentId && file.artifact.workspaceRelativePath) {
    const params = new URLSearchParams();
    params.set("agentId", agentId);
    params.set("path", file.artifact.workspaceRelativePath);
    return `/workspace-preview?${params.toString()}`;
  }
  const artifact = file.artifact;
  const target = artifact.previewUrl || artifact.downloadUrl;
  return agentEngineClient.resolveApiPath(target);
}

function openFileLocalFolder(file: RecentSavedFile): void {
  const folderPath = `${file.artifact.downloadUrl}/open-folder-native`;
  agentEngineClient
    .openNativeFile(folderPath)
    .then(() => {
      toast.success(`${file.artifact.name}이 있는 폴더를 열었어요.`);
    })
    .catch((error: unknown) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "로컬 폴더를 열지 못했어요.",
      );
    });
}

function FavoriteFileCard({
  favorite,
  file,
  agent,
  chat,
}: {
  favorite: FavoriteRecord;
  file: RecentSavedFile | undefined;
  agent: AgentRecord | null;
  chat: RockyChatRecord | undefined;
}) {
  const { emoji } = useAgentEmoji(agent?.id);
  const tinted = agent?.color
    ? {
        borderColor: `color-mix(in srgb, ${agent.color} 32%, var(--border))`,
        backgroundColor: `color-mix(in srgb, ${agent.color} 6%, var(--card))`,
      }
    : undefined;

  if (!file) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-lg border border-dashed border-border/70 bg-muted/30 p-4 text-sm">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-muted text-muted-foreground">
            <FileText className="size-4" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">
              즐겨찾기한 파일
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              파일을 찾을 수 없어요. 작업이 삭제되었을 수 있어요.
            </p>
          </div>
        </div>
        <FavoriteToggle
          input={{
            kind: "output-file",
            chatId: favorite.chatId,
            runId: favorite.runId,
            artifactId: favorite.artifactId,
          }}
        />
      </div>
    );
  }

  const openHref = fileOpenHref(file, agent?.id ?? null);
  const downloadHref = agentEngineClient.resolveApiPath(file.artifact.downloadUrl);
  return (
    <div
      style={tinted}
      className="rounded-lg border border-border/70 bg-card p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {agent ? (
            <AgentAvatar emoji={emoji} color={agent.color} size="md" />
          ) : (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-muted text-muted-foreground">
              <FileText className="size-4" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-xs font-medium text-foreground">
                {agent?.name ?? "Rocky"}
              </span>
              <Badge
                variant="outline"
                className="h-5 border-border bg-muted px-1.5 text-[10px] text-muted-foreground"
              >
                결과 파일
              </Badge>
            </div>
            <h3 className="mt-2 truncate text-sm font-semibold text-foreground">
              {file.artifact.name}
            </h3>
            <p className="mt-1 truncate text-xs leading-5 text-muted-foreground">
              {file.displayPath || file.artifact.contentType}
            </p>
            <div className="mt-2 truncate text-[11px] text-muted-foreground">
              {chat?.title ?? "원본 작업"} · {formatRockyTaskDateTime(favorite.createdAt)}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openFileLocalFolder(file);
            }}
            aria-label="로컬 폴더 열기"
            title="로컬 폴더 열기"
            className="inline-flex size-8 items-center justify-center rounded-full border border-border/70 bg-card text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
          >
            <FolderOpen className="size-3.5" />
          </button>
          <a
            href={downloadHref}
            download={file.artifact.name}
            aria-label="다운로드"
            title="다운로드"
            className="inline-flex size-8 items-center justify-center rounded-full border border-border/70 bg-card text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
          >
            <Download className="size-3.5" />
          </a>
          <FavoriteToggle
            input={{
              kind: "output-file",
              chatId: favorite.chatId,
              runId: favorite.runId,
              artifactId: favorite.artifactId,
            }}
          />
          <a
            href={openHref}
            target="_blank"
            rel="noreferrer"
            aria-label="새 탭에서 열기"
            title="새 탭에서 열기"
            className="inline-flex size-8 items-center justify-center rounded-full border border-foreground/20 bg-foreground text-background transition hover:bg-foreground/90"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}

function FavoriteMessagesGrid({
  favorites,
  chats,
  agents,
  taskAgentMap,
  loading,
}: {
  favorites: FavoriteRecord[];
  chats: RockyChatRecord[];
  agents: AgentRecord[];
  taskAgentMap: Record<string, string>;
  loading: boolean;
}) {
  if (loading) return <EmptyState icon={Star} message="불러오는 중입니다." />;
  if (favorites.length === 0) {
    return (
      <EmptyState
        icon={Star}
        message="에이전트 답변에 별을 누르면 여기에 모입니다."
      />
    );
  }
  return (
    <ul className="grid gap-2">
      {favorites.map((favorite) => {
        const { chat, agent } = resolveAgentForChat(
          favorite.chatId,
          chats,
          agents,
          taskAgentMap,
        );
        const message = chat?.messages?.find(
          (entry) => entry.id === favorite.messageId,
        );
        return (
          <li key={favorite.id}>
            <FavoriteMessageCard
              favorite={favorite}
              chat={chat}
              messageText={message?.text ?? ""}
              agent={agent}
            />
          </li>
        );
      })}
    </ul>
  );
}

function FavoriteMessageCard({
  favorite,
  chat,
  messageText,
  agent,
}: {
  favorite: FavoriteRecord;
  chat: RockyChatRecord | undefined;
  messageText: string;
  agent: AgentRecord | null;
}) {
  const { emoji } = useAgentEmoji(agent?.id);
  const tinted = agent?.color
    ? {
        borderColor: `color-mix(in srgb, ${agent.color} 32%, var(--border))`,
        backgroundColor: `color-mix(in srgb, ${agent.color} 6%, var(--card))`,
      }
    : undefined;

  const Wrapper = chat
    ? ({ children }: { children: React.ReactNode }) => (
        <Link
          to={`/tasks/${encodeURIComponent(chat.id)}`}
          style={tinted}
          className="block rounded-lg border border-border/70 bg-card p-4 no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-foreground/40 hover:shadow-md"
        >
          {children}
        </Link>
      )
    : ({ children }: { children: React.ReactNode }) => (
        <div
          style={tinted}
          className="rounded-lg border border-border/70 bg-card p-4 shadow-sm"
        >
          {children}
        </div>
      );

  return (
    <Wrapper>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {agent ? (
            <AgentAvatar emoji={emoji} color={agent.color} size="md" />
          ) : (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-muted text-muted-foreground">
              <Sparkles className="size-4" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-xs font-medium text-foreground">
                {agent?.name ?? "Rocky"}
              </span>
              <Badge
                variant="outline"
                className="h-5 border-border bg-muted px-1.5 text-[10px] text-muted-foreground"
              >
                답변
              </Badge>
            </div>
            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-foreground">
              {messageText || "내용을 찾을 수 없어요."}
            </p>
            <div className="mt-2 truncate text-[11px] text-muted-foreground">
              {chat?.title ?? "원본 작업"} · {formatRockyTaskDateTime(favorite.createdAt)}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span onClick={(event) => event.stopPropagation()}>
            <FavoriteToggle
              input={{
                kind: "agent-message",
                chatId: favorite.chatId,
                messageId: favorite.messageId,
              }}
            />
          </span>
          {chat ? <ArrowRight className="size-4 text-muted-foreground" /> : null}
        </div>
      </div>
    </Wrapper>
  );
}

function FavoriteTasksGrid({
  favorites,
  chats,
  agents,
  taskAgentMap,
  loading,
}: {
  favorites: FavoriteRecord[];
  chats: RockyChatRecord[];
  agents: AgentRecord[];
  taskAgentMap: Record<string, string>;
  loading: boolean;
}) {
  if (loading) return <EmptyState icon={Star} message="불러오는 중입니다." />;
  if (favorites.length === 0) {
    return (
      <EmptyState
        icon={Star}
        message="작업 카드에 별을 누르면 여기에 모입니다."
      />
    );
  }
  return (
    <ul className="grid gap-2">
      {favorites.map((favorite) => {
        const { chat, agent } = resolveAgentForChat(
          favorite.chatId,
          chats,
          agents,
          taskAgentMap,
        );
        return (
          <li key={favorite.id}>
            <FavoriteTaskCard favorite={favorite} chat={chat} agent={agent} />
          </li>
        );
      })}
    </ul>
  );
}

function FavoriteTaskCard({
  favorite,
  chat,
  agent,
}: {
  favorite: FavoriteRecord;
  chat: RockyChatRecord | undefined;
  agent: AgentRecord | null;
}) {
  const { emoji } = useAgentEmoji(agent?.id);
  const tinted = agent?.color
    ? {
        borderColor: `color-mix(in srgb, ${agent.color} 32%, var(--border))`,
        backgroundColor: `color-mix(in srgb, ${agent.color} 6%, var(--card))`,
      }
    : undefined;

  if (!chat) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-lg border border-dashed border-border/70 bg-muted/30 p-4 text-sm">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-muted text-muted-foreground">
            <ListTodo className="size-4" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">
              즐겨찾기한 작업
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              작업을 찾을 수 없어요. 삭제되었을 수 있어요.
            </p>
          </div>
        </div>
        <FavoriteToggle input={{ kind: "task", chatId: favorite.chatId }} />
      </div>
    );
  }

  const status = getRockyTaskStatus(chat);
  return (
    <Link
      to={`/tasks/${encodeURIComponent(chat.id)}`}
      style={tinted}
      className="block rounded-lg border bg-card p-4 no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-foreground/40 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {agent ? (
            <AgentAvatar emoji={emoji} color={agent.color} size="md" />
          ) : (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-muted text-muted-foreground">
              <Sparkles className="size-4" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-xs font-medium text-foreground">
                {agent?.name ?? "Rocky"}
              </span>
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  rockyTaskStatusTone(status),
                )}
              >
                {rockyTaskStatusLabel(status)}
              </span>
            </div>
            <h3 className="mt-2 truncate text-sm font-semibold text-foreground">
              {chat.title || getRockyTaskRequest(chat) || "제목 없음"}
            </h3>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {getRockyTaskSummary(chat)}
            </p>
            <div className="mt-2 text-[11px] text-muted-foreground">
              {formatRockyTaskDateTime(favorite.createdAt)}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span onClick={(event) => event.stopPropagation()}>
            <FavoriteToggle input={{ kind: "task", chatId: chat.id }} />
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
        </div>
      </div>
    </Link>
  );
}
