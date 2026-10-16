import { describe, expect, test } from "vitest";

import {
  createMessageReader,
  decodeFrame,
  MAX_MESSAGE_BYTES,
  MESSAGE_TYPE_EVENT,
  MESSAGE_TYPE_FRAME
} from "./web-app-protocol";

const encodeMessage = (type: number, payload: Uint8Array) => {
  const out = new Uint8Array(4 + 1 + payload.length);
  new DataView(out.buffer).setUint32(0, payload.length + 1);
  out[4] = type;
  out.set(payload, 5);
  return out;
};

const encodeFrame = (meta: object, jpeg: number[]) => {
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  const payload = new Uint8Array(4 + metaBytes.length + jpeg.length);
  new DataView(payload.buffer).setUint32(0, metaBytes.length);
  payload.set(metaBytes, 4);
  payload.set(jpeg, 4 + metaBytes.length);
  return payload;
};

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  parts.forEach((p) => {
    out.set(p, offset);
    offset += p.length;
  });
  return out;
};

const toArrayBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

describe("web app viewer protocol", () => {
  const event = encodeMessage(
    MESSAGE_TYPE_EVENT,
    new TextEncoder().encode(JSON.stringify({ kind: "navigated", url: "http://app.internal/" }))
  );
  const frame = encodeMessage(
    MESSAGE_TYPE_FRAME,
    encodeFrame({ seq: 1, ts: 1, w: 1280, h: 800 }, [0xff, 0xd8, 0x01])
  );
  const stream = concat(event, frame);

  const collect = (chunks: Uint8Array[]) => {
    const received: { type: number; payload: Uint8Array }[] = [];
    const read = createMessageReader((type, payload) =>
      received.push({ type, payload: payload.slice() })
    );
    chunks.forEach((chunk) => read(toArrayBuffer(chunk)));
    return received;
  };

  test("yields the same messages however the stream is split into chunks", () => {
    const whole = collect([stream]);
    const byteByByte = collect(Array.from(stream, (b) => new Uint8Array([b])));
    const splitMidHeader = collect([stream.subarray(0, 2), stream.subarray(2)]);
    const splitMidFrame = collect([
      stream.subarray(0, event.length + 7),
      stream.subarray(event.length + 7)
    ]);

    expect(whole.map((m) => m.type)).toEqual([MESSAGE_TYPE_EVENT, MESSAGE_TYPE_FRAME]);
    [byteByByte, splitMidHeader, splitMidFrame].forEach((received) =>
      expect(received).toEqual(whole)
    );
  });

  test("decodes frame metadata and JPEG bytes", () => {
    const [, frameMessage] = collect([stream]);
    const { meta, jpeg } = decodeFrame(frameMessage.payload);
    expect(meta).toEqual({ seq: 1, ts: 1, w: 1280, h: 800 });
    expect(Array.from(jpeg)).toEqual([0xff, 0xd8, 0x01]);
  });

  test("rejects a length over the limit instead of buffering it", () => {
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, MAX_MESSAGE_BYTES + 1);
    expect(() => collect([header])).toThrow();
  });
});
