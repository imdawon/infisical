// Wire format shared with the gateway's web app handler (cli: packages/pam/handlers/webapp/protocol.go):
// [u32 big-endian length][u8 type][payload], where length counts the type byte.
export const MESSAGE_TYPE_FRAME = 0x01;
export const MESSAGE_TYPE_EVENT = 0x02;
export const MESSAGE_TYPE_INPUT = 0x10;
export const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

export type SelectMenu = {
  options: { label: string; disabled?: boolean }[];
  selected: number;
  // The <select>'s box in the remote page's CSS pixels
  rect: { x: number; y: number; w: number; h: number };
};

export type GatewayEvent = {
  kind: "ready" | "navigated" | "ended" | "blocked" | "select";
  url?: string;
  w?: number;
  h?: number;
  reason?: string;
  options?: SelectMenu["options"];
  selected?: number;
  rect?: SelectMenu["rect"];
};

export type FrameMeta = { seq: number; ts: number; w: number; h: number };

// The gateway accepts only these input shapes and drops anything else. Coordinates are in the remote page's CSS
// pixels. Modifiers use CDP's bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8.
export type WebAppInput =
  | {
      t: "mouse";
      kind: "down" | "up" | "move";
      x: number;
      y: number;
      button: "none" | "left" | "middle" | "right";
      clickCount: number;
      modifiers: number;
    }
  | { t: "wheel"; x: number; y: number; dx: number; dy: number }
  | { t: "key"; kind: "down" | "up"; key: string; code: string; text: string; modifiers: number }
  | { t: "resize"; w: number; h: number }
  | { t: "nav"; action: "back" | "forward" | "reload" }
  // The option picked in the viewer-drawn <select> menu, or -1 to dismiss it
  | { t: "select"; index: number };

export const encodeInput = (input: WebAppInput): ArrayBuffer => {
  const json = new TextEncoder().encode(JSON.stringify(input));
  const out = new Uint8Array(4 + 1 + json.length);
  new DataView(out.buffer).setUint32(0, json.length + 1);
  out[4] = MESSAGE_TYPE_INPUT;
  out.set(json, 5);
  return out.buffer;
};

// The backend pipes raw bytes, so a WebSocket message can hold part of a frame or several frames. This buffers
// the stream and yields only complete messages.
export const createMessageReader = (onMessage: (type: number, payload: Uint8Array) => void) => {
  let buffer = new Uint8Array(0);

  return (chunk: ArrayBuffer) => {
    const incoming = new Uint8Array(chunk);
    const merged = new Uint8Array(buffer.length + incoming.length);
    merged.set(buffer);
    merged.set(incoming, buffer.length);
    buffer = merged;

    let offset = 0;
    while (buffer.length - offset >= 4) {
      const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 4);
      const length = view.getUint32(0);
      if (length === 0 || length > MAX_MESSAGE_BYTES) {
        throw new Error(`Invalid message length ${length}`);
      }
      if (buffer.length - offset - 4 < length) break;
      const body = buffer.subarray(offset + 4, offset + 4 + length);
      onMessage(body[0], body.subarray(1));
      offset += 4 + length;
    }
    buffer = buffer.slice(offset);
  };
};

export const decodeFrame = (payload: Uint8Array): { meta: FrameMeta; jpeg: Uint8Array } => {
  const metaLength = new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0);
  const meta = JSON.parse(
    new TextDecoder().decode(payload.subarray(4, 4 + metaLength))
  ) as FrameMeta;
  return { meta, jpeg: payload.subarray(4 + metaLength) };
};
