import net from "node:net";

import { logger } from "@app/lib/logger";

import { TSessionContext, TSessionHandlerResult } from "./pam-web-access-types";

const TCP_CONNECT_TIMEOUT_MS = 30_000;
const WS_HIGH_WATER_MARK = 1024 * 1024;

const wsRawToBuffer = (raw: Buffer | ArrayBuffer | Buffer[]): Buffer => {
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return Buffer.from(raw);
};

type TBytePipeOptions = {
  // Prefixes log lines, e.g. "rdp" → "rdp session: tcp socket closed"
  logLabel: string;
  // Names the protocol in the connect-timeout error, e.g. "RDP"
  protocolName: string;
};

// Pipes binary WebSocket frames to the gateway tunnel and back, for account types whose protocol client runs
// in the browser (RDP via IronRDP) or whose protocol is entirely between the browser and the gateway (web app).
// The backend never parses these bytes.
export const handleBytePipeSession = async (
  ctx: TSessionContext,
  { logLabel, protocolName }: TBytePipeOptions
): Promise<TSessionHandlerResult> => {
  const { socket, relayPort, sessionId, onCleanup, earlyMessages, releaseEarlyBuffer } = ctx;

  const tcpSocket = new net.Socket();
  let cleanedUp = false;

  const teardown = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      tcpSocket.destroy();
    } catch (err) {
      logger.debug(err, `${logLabel} session: error destroying tcp socket`);
    }
  };

  return new Promise<TSessionHandlerResult>((resolve, reject) => {
    const connectTimeout = setTimeout(() => {
      logger.error({ sessionId }, `${logLabel} session: relay connect timed out`);
      if (!cleanedUp) onCleanup();
      teardown();
      reject(new Error(`${protocolName} relay connection timed out`));
    }, TCP_CONNECT_TIMEOUT_MS);

    tcpSocket.once("connect", () => {
      clearTimeout(connectTimeout);
      tcpSocket.removeAllListeners("error");

      releaseEarlyBuffer();
      for (const msg of earlyMessages) {
        if (msg.isBinary && tcpSocket.writable) {
          tcpSocket.write(msg.data);
        }
      }

      socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
        if (cleanedUp || tcpSocket.destroyed || !tcpSocket.writable) return;
        if (!isBinary) return;
        const buf = wsRawToBuffer(raw);
        if (buf.length === 0) return;
        try {
          tcpSocket.write(buf);
        } catch {
          if (!cleanedUp) onCleanup();
          teardown();
        }
      });

      tcpSocket.on("data", (chunk: Buffer) => {
        if (cleanedUp || socket.readyState !== socket.OPEN) return;
        if (socket.bufferedAmount > WS_HIGH_WATER_MARK) {
          tcpSocket.pause();
        }
        socket.send(chunk, { binary: true }, (err) => {
          if (err) {
            logger.error(err, `${logLabel} session: ws send failed`);
            if (!cleanedUp) onCleanup();
            teardown();
            return;
          }
          if (tcpSocket.isPaused() && socket.bufferedAmount <= WS_HIGH_WATER_MARK) {
            tcpSocket.resume();
          }
        });
      });

      tcpSocket.on("close", () => {
        logger.info({ sessionId }, `${logLabel} session: tcp socket closed`);
        if (!cleanedUp) onCleanup();
        teardown();
        try {
          socket.close();
        } catch (err) {
          logger.debug(err, `${logLabel} session: error closing ws after tcp close`);
        }
      });

      tcpSocket.on("error", (err) => {
        logger.error(err, `${logLabel} session: tcp socket error`);
        if (!cleanedUp) onCleanup();
        teardown();
      });

      resolve({
        cleanup: async () => {
          teardown();
        }
      });
    });

    tcpSocket.once("error", (err) => {
      clearTimeout(connectTimeout);
      logger.error(err, `${logLabel} session: failed to connect to relay`);
      if (!cleanedUp) onCleanup();
      teardown();
      reject(err);
    });

    tcpSocket.connect(relayPort, "127.0.0.1");
  });
};
