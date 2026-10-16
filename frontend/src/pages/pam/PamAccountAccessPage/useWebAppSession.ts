import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";

import { createNotification } from "@app/components/notifications";
import { apiRequest } from "@app/config/request";

import {
  createMessageReader,
  decodeFrame,
  encodeInput,
  FrameMeta,
  GatewayEvent,
  MESSAGE_TYPE_EVENT,
  MESSAGE_TYPE_FRAME,
  WebAppInput
} from "./web-app-protocol";

const WEB_APP_SESSION_FAILED_MESSAGE = "Unable to start the web app session.";

export type WebAppSessionStatus = "starting" | "live" | "ended" | "error";

type UseWebAppSessionOptions = {
  accountId: string;
  reason?: string;
  mfaSessionId?: string;
};

export const useWebAppSession = ({ accountId, reason, mfaSessionId }: UseWebAppSessionOptions) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const generationRef = useRef(0);

  const [status, setStatus] = useState<WebAppSessionStatus>("starting");
  const [error, setError] = useState<string | null>(null);
  const [endReason, setEndReason] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);

  const teardown = useCallback(() => {
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
  }, []);

  const connect = useCallback(async () => {
    teardown();
    generationRef.current += 1;
    const gen = generationRef.current;
    const isCurrent = () => gen === generationRef.current;

    setStatus("starting");
    setError(null);
    setEndReason(null);
    setCurrentUrl(null);
    setBlockedUrl(null);

    const { data } = await apiRequest.post<{ ticket: string }>(
      `/api/v1/pam/accounts/${accountId}/web-access-ticket`,
      { reason, mfaSessionId }
    );
    if (!isCurrent()) return;

    const { protocol, host } = window.location;
    const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(
      `${wsProtocol}//${host}/api/v1/pam/accounts/${accountId}/web-access?ticket=${encodeURIComponent(data.ticket)}`
    );
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;

    // Frames decode asynchronously, so a slow decode must not paint over a newer frame.
    let lastDrawnSeq = 0;
    const drawFrame = async (meta: FrameMeta, jpeg: Uint8Array) => {
      const bitmap = await createImageBitmap(new Blob([jpeg], { type: "image/jpeg" }));
      const canvas = canvasRef.current;
      if (!isCurrent() || !canvas || meta.seq <= lastDrawnSeq) {
        bitmap.close();
        return;
      }
      lastDrawnSeq = meta.seq;
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
      bitmap.close();
      setStatus("live");
    };

    const readMessages = createMessageReader((type, payload) => {
      if (type === MESSAGE_TYPE_FRAME) {
        const { meta, jpeg } = decodeFrame(payload);
        drawFrame(meta, jpeg).catch(() => {
          // A frame that fails to decode is dropped; the next one replaces it.
        });
        return;
      }
      if (type === MESSAGE_TYPE_EVENT) {
        const event = JSON.parse(new TextDecoder().decode(payload)) as GatewayEvent;
        if (event.kind === "navigated" && event.url) setCurrentUrl(event.url);
        if (event.kind === "blocked" && event.url) setBlockedUrl(event.url);
        if (event.kind === "ended") setEndReason(event.reason ?? null);
      }
    });

    socket.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
      if (!isCurrent() || typeof event.data === "string") return;
      try {
        readMessages(event.data);
      } catch {
        setError(WEB_APP_SESSION_FAILED_MESSAGE);
        setStatus("error");
        socket.close();
      }
    };

    socket.onclose = () => {
      if (!isCurrent()) return;
      socketRef.current = null;
      setStatus((prev) => (prev === "error" ? prev : "ended"));
    };
  }, [accountId, reason, mfaSessionId, teardown]);

  const handleConnectError = useCallback((err: unknown) => {
    let message = WEB_APP_SESSION_FAILED_MESSAGE;
    if (axios.isAxiosError(err)) {
      const apiMessage = (err.response?.data as { message?: string } | undefined)?.message;
      if (apiMessage) message = apiMessage;
    } else if (err instanceof Error && err.message) {
      message = err.message;
    }
    setError(message);
    setStatus("error");
    createNotification({ type: "error", text: message });
  }, []);

  useEffect(() => {
    connect().catch(handleConnectError);
    return () => {
      generationRef.current += 1;
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disconnect = useCallback(() => {
    generationRef.current += 1;
    teardown();
    setStatus("ended");
  }, [teardown]);

  const reconnect = useCallback(() => {
    connect().catch(handleConnectError);
  }, [connect, handleConnectError]);

  const sendInput = useCallback((input: WebAppInput) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(encodeInput(input));
  }, []);

  const dismissBlocked = useCallback(() => setBlockedUrl(null), []);

  return {
    canvasRef,
    status,
    error,
    endReason,
    currentUrl,
    blockedUrl,
    dismissBlocked,
    disconnect,
    reconnect,
    sendInput
  };
};
