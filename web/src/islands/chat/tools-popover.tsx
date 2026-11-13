// Composer "Tools" indicator (plug icon beside Send): the MCP servers the chat's agent works with and their status.
// While a run is open the rows are what the agent runtime reports (Claude SDK init / mcpServerStatus(), Codex
// mcpServer/startupStatus/updated / mcpServerStatus/list); before it starts, the configured list, "Not started".
import { useState } from "react";
import { PlugIcon, RotateCwIcon } from "lucide-react";
import { LogoIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { refreshMcpStatus, useMcpStatus, type McpServer, type McpStatus } from "./agent-status";
import type { ChatState } from "./store";

const STATUS_LABEL: Record<McpStatus, string> = {
  connected: "Connected",
  starting: "Starting",
  failed: "Failed",
  "needs-auth": "Needs sign-in",
  disabled: "Disabled",
  "not-started": "Not started",
};

const displayName = (server: McpServer) => (server.builtIn ? "Verynize" : server.name);

function ServerRow({ server }: { server: McpServer }) {
  return (
    <li
      data-mcp-server={server.name}
      data-status={server.status}
      title={server.error || undefined}
      className="flex h-8 items-center gap-2.5 px-1"
    >
      {server.builtIn ? (
        <LogoIcon className="size-4 shrink-0 text-foreground-2" />
      ) : (
        <PlugIcon className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{displayName(server)}</span>
      <span
        className={cn(
          "shrink-0 text-sm",
          server.status === "failed" || server.status === "needs-auth"
            ? "text-destructive"
            : server.status === "connected"
              ? "text-foreground-2"
              : "text-muted-foreground",
        )}
      >
        {STATUS_LABEL[server.status]}
      </span>
    </li>
  );
}

export function ToolsPopover({ state }: { state: ChatState }) {
  const chatId = state.conversationId;
  const agent = state.defaults.agent || "claude";
  const snapshot = useMcpStatus(chatId);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const refresh = () => {
    setLoading(true);
    refreshMcpStatus(chatId, agent)
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  // Rows of another provider (the chat switched agents) are hidden until this agent reports.
  const current = snapshot && (!snapshot.agent || snapshot.agent === agent) ? snapshot : undefined;
  const servers = current?.servers ?? [];
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) refresh();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Tools"
          title="Tools"
          data-chat-indicator="tools"
        >
          <PlugIcon className="size-4 rotate-45" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={8}
        data-chat-popover="tools"
        className="w-80"
      >
        <div className="-m-1 flex flex-col gap-1">
          <div className="flex h-8 items-center justify-between pl-1">
            <span className="text-sm text-foreground">Tools</span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Refresh tools"
              title="Refresh"
              disabled={loading}
              onClick={refresh}
              data-mcp-refresh=""
            >
              <RotateCwIcon
                className={cn("size-4", loading && "animate-spin motion-reduce:animate-none")}
              />
            </Button>
          </div>
          {servers.length > 0 && (
            <ul aria-label="MCP servers" className="flex flex-col">
              {servers.map((server) => (
                <ServerRow key={server.name} server={server} />
              ))}
            </ul>
          )}
          {!servers.length && loading && (
            <p className="px-1 py-1.5 text-sm text-muted-foreground">Checking…</p>
          )}
          {current?.error && <p className="px-1 text-xs text-destructive">{current.error}</p>}
          {(!current || !current.live) && (
            <p className="px-1 pt-1 pb-1.5 text-sm text-subtle-foreground">
              The list fills in when the agent starts.
            </p>
          )}
          {current?.live && !state.busy && (
            <p className="px-1 pt-1 pb-1.5 text-sm text-subtle-foreground">
              Last reported by the agent.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
