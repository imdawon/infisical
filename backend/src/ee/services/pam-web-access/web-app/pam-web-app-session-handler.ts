import { handleBytePipeSession } from "../pam-byte-pipe-session-handler";
import { TSessionContext, TSessionHandlerResult } from "../pam-web-access-types";

// The gateway runs the isolated browser and speaks the viewer protocol itself (frames down, input up), so the
// backend only pipes bytes between the viewer's WebSocket and the gateway tunnel.
export const handleWebAppSession = (ctx: TSessionContext): Promise<TSessionHandlerResult> =>
  handleBytePipeSession(ctx, { logLabel: "web-app", protocolName: "Web app" });
