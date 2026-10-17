// Listens to aisstream.io for a fixed time and hands each message text to the caller.
// Protocol (https://aisstream.io/documentation, read 2026-10-17): open the socket, send the
// subscription within 3 s, then receive one JSON message per AIS report. 3 connections per key.
// Uses the runtime's WebSocket, so it runs unchanged in the edge runtime and in the local harness.
// The server sometimes drops the socket mid-window (seen at 69 s of 105 s on 2026-10-17), so the
// listener reconnects for the time left, one connection at a time.
import type { Result } from "../../../src/lib/result.ts";
import { AISSTREAM_MESSAGE_TYPES } from "../../../src/lib/live/ais-reports.ts";

const STREAM_URL = "wss://stream.aisstream.io/v0/stream";
// aisstream wants the subscription within 3 s of opening; the open itself gets a little longer.
const OPEN_TIMEOUT_MS = 10_000;
// The whole world, as aisstream's [[south, west], [north, east]] corner pairs.
const WORLD_BOUNDING_BOXES = [[[-90, -180], [90, 180]]];
// Connections per run, one after the other: never more than one open, within the 3 per key.
const MAX_CONNECTIONS = 3;
// Not worth reconnecting for less than this.
const MIN_RECONNECT_WINDOW_MS = 5_000;
const RECONNECT_DELAY_MS = 1_000;

export type ListenStats = {
  openedAfterMs: number;
  listenedMs: number;
  messageCount: number;
  messageBytes: number;
  // Sec-WebSocket-Extensions agreed with the server, "" when the stream is uncompressed.
  extensions: string;
  // Set when the server closed a connection before the listening time ended.
  closedEarly: string | null;
  connections: number;
};

export type ListenOptions = {
  apiKey: string;
  listenMs: number;
  onMessageText: (messageText: string) => void;
  // Tests point this at a local server; production uses aisstream.
  streamUrl?: string;
};

/** One connection: resolves after `listenMs`, or earlier with what arrived if the server closes. Never rejects. */
function listenOnce({ apiKey, listenMs, onMessageText, streamUrl = STREAM_URL }: ListenOptions): Promise<Result<ListenStats>> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const decoder = new TextDecoder();
    let openedAt: number | null = null;
    let messageCount = 0;
    let messageBytes = 0;
    let lastErrorMessage: string | null = null;
    let isSettled = false;
    let listenTimer: ReturnType<typeof setTimeout> | undefined;

    let socket: WebSocket;
    try {
      socket = new WebSocket(streamUrl);
    } catch (error) {
      resolve({ ok: false, reason: `aisstream socket could not be created: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    socket.binaryType = "arraybuffer";

    const readStats = (closedEarly: string | null): ListenStats => ({
      openedAfterMs: openedAt === null ? 0 : Math.round(openedAt - startedAt),
      listenedMs: openedAt === null ? 0 : Math.round(performance.now() - openedAt),
      messageCount,
      messageBytes,
      extensions: socket.extensions,
      closedEarly,
      connections: 1,
    });

    const settle = (outcome: Result<ListenStats>) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(openTimer);
      clearTimeout(listenTimer);
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close(1000, "listening window over");
      resolve(outcome);
    };

    const openTimer = setTimeout(() => settle({ ok: false, reason: `aisstream did not open within ${OPEN_TIMEOUT_MS} ms` }), OPEN_TIMEOUT_MS);

    socket.onopen = () => {
      openedAt = performance.now();
      clearTimeout(openTimer);
      // The subscription carries the key: it goes to the socket only, never to a log.
      socket.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: WORLD_BOUNDING_BOXES, FilterMessageTypes: [...AISSTREAM_MESSAGE_TYPES] }));
      listenTimer = setTimeout(() => settle({ ok: true, value: readStats(null) }), listenMs);
    };

    socket.onmessage = (event: MessageEvent) => {
      // aisstream sends binary frames that hold UTF-8 JSON; text frames are accepted too.
      const messageText = typeof event.data === "string" ? event.data : event.data instanceof ArrayBuffer ? decoder.decode(event.data) : null;
      if (messageText === null) return;
      messageCount += 1;
      messageBytes += typeof event.data === "string" ? messageText.length : event.data.byteLength;
      onMessageText(messageText);
    };

    socket.onerror = (event: Event) => {
      if (event instanceof ErrorEvent && event.message) lastErrorMessage = event.message;
    };

    socket.onclose = (event: CloseEvent) => {
      const detail = [event.reason, lastErrorMessage].filter((part): part is string => typeof part === "string" && part !== "").join("; ");
      const reason = `aisstream closed the connection (code ${event.code}${detail === "" ? "" : `: ${detail}`})`;
      settle(messageCount > 0 ? { ok: true, value: readStats(reason) } : { ok: false, reason });
    };
  });
}

/**
 * Listens for `listenMs` in total, reconnecting when the server drops the socket early. A connection
 * that ends without any message (refused key, outage) stops the run: retrying would not help.
 */
export async function listenToAisstream({ apiKey, listenMs, onMessageText, streamUrl }: ListenOptions): Promise<Result<ListenStats>> {
  const deadline = performance.now() + listenMs;
  let combined: ListenStats | null = null;
  for (let connection = 1; connection <= MAX_CONNECTIONS; connection += 1) {
    const remainingMs = Math.round(deadline - performance.now());
    if (combined !== null && remainingMs < MIN_RECONNECT_WINDOW_MS) break;
    const outcome = await listenOnce({ apiKey, listenMs: remainingMs, onMessageText, streamUrl });
    if (!outcome.ok) return combined === null ? outcome : { ok: true, value: { ...combined, closedEarly: `${combined.closedEarly}; reconnect failed: ${outcome.reason}` } };
    const stats = outcome.value;
    combined =
      combined === null
        ? stats
        : {
            openedAfterMs: combined.openedAfterMs,
            listenedMs: combined.listenedMs + stats.listenedMs,
            messageCount: combined.messageCount + stats.messageCount,
            messageBytes: combined.messageBytes + stats.messageBytes,
            extensions: stats.extensions,
            closedEarly: [combined.closedEarly, stats.closedEarly].filter((reason): reason is string => reason !== null).join("; ") || null,
            connections: connection,
          };
    if (stats.closedEarly === null) break;
    await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
  }
  return combined === null ? { ok: false, reason: "aisstream was not reached" } : { ok: true, value: combined };
}
