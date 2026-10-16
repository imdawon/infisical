import { handleBytePipeSession } from "../pam-byte-pipe-session-handler";
import { TSessionContext, TSessionHandlerResult } from "../pam-web-access-types";

// The RDP client runs in the browser (IronRDP), so the backend only pipes bytes to the gateway.
export const handleRdpSession = (ctx: TSessionContext): Promise<TSessionHandlerResult> =>
  handleBytePipeSession(ctx, { logLabel: "rdp", protocolName: "RDP" });
