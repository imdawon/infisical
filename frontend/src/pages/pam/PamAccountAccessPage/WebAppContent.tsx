import { TriangleAlert } from "lucide-react";

import { ContentLoader } from "@app/components/v2";
import { Button } from "@app/components/v3";
import { TPamAccount } from "@app/hooks/api/pam";

import { DisconnectedScreen } from "./DisconnectedScreen";
import { useWebAppSession, WebAppSessionStatus } from "./useWebAppSession";
import { WebAccessStatusCard } from "./WebAccessStatusCard";

type WebAppContentProps = {
  account: TPamAccount;
  reason?: string;
  mfaSessionId?: string;
};

const STATUS_LABEL: Record<WebAppSessionStatus, string> = {
  starting: "Starting secure browser…",
  live: "Live",
  ended: "Ended",
  error: "Error"
};

const STATUS_DOT: Record<WebAppSessionStatus, string> = {
  starting: "bg-warning",
  live: "bg-success",
  ended: "bg-muted",
  error: "bg-danger"
};

export const WebAppContent = ({ account, reason, mfaSessionId }: WebAppContentProps) => {
  const { canvasRef, status, error, endReason, currentUrl, disconnect, reconnect } =
    useWebAppSession({ accountId: account.id, reason, mfaSessionId });

  return (
    <div className="flex h-dvh w-screen flex-col bg-background">
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <canvas
          ref={canvasRef}
          className={`max-h-full max-w-full ${status === "live" ? "" : "invisible"}`}
        />
        {status === "starting" && (
          <ContentLoader text="Starting secure browser…" className="absolute inset-0 z-10 h-full" />
        )}
        {status === "error" && (
          <WebAccessStatusCard
            overlay
            tone="danger"
            icon={TriangleAlert}
            title="Session failed"
            description={error ?? undefined}
          >
            <Button variant="pam" isFullWidth onClick={reconnect}>
              Reconnect
            </Button>
          </WebAccessStatusCard>
        )}
        {status === "ended" && (
          <DisconnectedScreen
            onReconnect={reconnect}
            description={
              endReason
                ? `This session has ended (${endReason}). Reconnect to start a new one.`
                : undefined
            }
          />
        )}
      </div>
      <div className="flex h-[33px] shrink-0 items-center justify-between gap-4 border-t border-border bg-card px-3 text-xs">
        <span className="flex items-center gap-1.5">
          <span className={`inline-block size-2 rounded-full ${STATUS_DOT[status]}`} />
          <span className="text-muted">{STATUS_LABEL[status]}</span>
          {status === "live" && (
            <button
              type="button"
              onClick={disconnect}
              className="ml-2 text-muted hover:text-danger"
            >
              End session
            </button>
          )}
        </span>
        <div className="flex min-w-0 items-center gap-4">
          {currentUrl && <span className="truncate font-mono text-muted">{currentUrl}</span>}
          <span className="shrink-0">
            <span className="text-muted">Account:</span>{" "}
            <span className="text-muted">{account.name}</span>
          </span>
        </div>
      </div>
    </div>
  );
};
