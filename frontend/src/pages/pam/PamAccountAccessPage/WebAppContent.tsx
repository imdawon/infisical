import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, RotateCw, ShieldX, TriangleAlert, X } from "lucide-react";

import { ContentLoader } from "@app/components/v2";
import { Button } from "@app/components/v3";
import { TPamAccount } from "@app/hooks/api/pam";

import { DisconnectedScreen } from "./DisconnectedScreen";
import { useWebAppInput } from "./useWebAppInput";
import { useWebAppSession, WebAppSessionStatus } from "./useWebAppSession";
import { WebAccessStatusCard } from "./WebAccessStatusCard";
import { WebAppSelectMenu } from "./WebAppSelectMenu";

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

const BLOCKED_NOTICE_MS = 6000;

const NavButton = ({
  label,
  onClick,
  children
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className="rounded p-1 text-muted hover:bg-foreground/10 hover:text-foreground"
  >
    {children}
  </button>
);

export const WebAppContent = ({ account, reason, mfaSessionId }: WebAppContentProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const {
    canvasRef,
    status,
    error,
    endReason,
    currentUrl,
    blockedUrl,
    dismissBlocked,
    selectMenu,
    chooseSelectOption,
    disconnect,
    reconnect,
    sendInput
  } = useWebAppSession({ accountId: account.id, reason, mfaSessionId });

  const isLive = status === "live";
  useWebAppInput({ canvasRef, containerRef, isLive, sendInput });

  useEffect(() => {
    if (!blockedUrl) return undefined;
    const timer = setTimeout(dismissBlocked, BLOCKED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [blockedUrl, dismissBlocked]);

  return (
    <div className="flex h-dvh w-screen flex-col bg-background">
      <div
        ref={containerRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
      >
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label={`Remote browser for ${account.name}`}
          className={`max-h-full max-w-full outline-none ${isLive ? "" : "invisible"}`}
        />
        {selectMenu && isLive && (
          <WebAppSelectMenu
            menu={selectMenu}
            canvasRef={canvasRef}
            containerRef={containerRef}
            onChoose={(index) => {
              chooseSelectOption(index);
              canvasRef.current?.focus();
            }}
          />
        )}
        {blockedUrl && isLive && (
          <div className="absolute top-3 left-1/2 z-10 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-md border border-danger/40 bg-card px-3 py-2 text-xs shadow">
            <ShieldX className="size-4 shrink-0 text-danger" />
            <span className="truncate">
              Blocked <span className="font-mono">{blockedUrl}</span>. This account only allows its
              own site.
            </span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={dismissBlocked}
              className="text-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
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
          {isLive && (
            <>
              <span className="ml-2 flex items-center gap-0.5">
                <NavButton label="Back" onClick={() => sendInput({ t: "nav", action: "back" })}>
                  <ArrowLeft className="size-3.5" />
                </NavButton>
                <NavButton
                  label="Forward"
                  onClick={() => sendInput({ t: "nav", action: "forward" })}
                >
                  <ArrowRight className="size-3.5" />
                </NavButton>
                <NavButton label="Reload" onClick={() => sendInput({ t: "nav", action: "reload" })}>
                  <RotateCw className="size-3.5" />
                </NavButton>
              </span>
              <button
                type="button"
                onClick={disconnect}
                className="ml-2 text-muted hover:text-danger"
              >
                End session
              </button>
            </>
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
