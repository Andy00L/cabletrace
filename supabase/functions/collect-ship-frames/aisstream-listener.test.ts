// Listener tests against a local WebSocket server standing in for aisstream.
// Run: deno test --no-lock --allow-net --config supabase/functions/collect-ship-frames/deno.json supabase/functions/collect-ship-frames/aisstream-listener.test.ts
import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { listenToAisstream } from "./aisstream-listener.ts";

type ServerBehaviour = "drop-after-two" | "refuse";

// Answers each connection like aisstream: reads the subscription, then sends two reports (one binary,
// one text) and drops the socket, or closes at once as for a refused key.
function startFakeAisstream(behaviour: ServerBehaviour) {
  const subscriptions: unknown[] = [];
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, (request) => {
    const { socket, response } = Deno.upgradeWebSocket(request);
    socket.onmessage = (event) => {
      subscriptions.push(JSON.parse(String(event.data)));
      if (behaviour === "refuse") {
        socket.close(1008, "Api Key Is Not Valid");
        return;
      }
      socket.send(new TextEncoder().encode('{"MessageType":"PositionReport","sequence":1}'));
      socket.send('{"MessageType":"PositionReport","sequence":2}');
      setTimeout(() => socket.close(1011, "server restart"), 50);
    };
    return response;
  });
  return { server, subscriptions, url: `ws://127.0.0.1:${server.addr.port}` };
}

Deno.test("reconnects when the server drops the socket, at most 3 connections in a run", async () => {
  const fake = startFakeAisstream("drop-after-two");
  const received: string[] = [];
  const outcome = await listenToAisstream({
    apiKey: "test-key",
    listenMs: 30_000,
    onMessageText: (messageText) => received.push(messageText),
    streamUrl: fake.url,
  });
  await fake.server.shutdown();
  ok(outcome.ok);
  equal(outcome.value.connections, 3);
  equal(outcome.value.messageCount, 6);
  equal(received.length, 6);
  equal(fake.subscriptions.length, 3);
  ok(outcome.value.closedEarly?.includes("server restart"));
  deepStrictEqual(fake.subscriptions[0], {
    APIKey: "test-key",
    BoundingBoxes: [[[-90, -180], [90, 180]]],
    FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport", "ShipStaticData", "StaticDataReport"],
  });
});

Deno.test("gives up without retrying when the first connection brings nothing", async () => {
  const fake = startFakeAisstream("refuse");
  const outcome = await listenToAisstream({ apiKey: "bad-key", listenMs: 10_000, onMessageText: () => {}, streamUrl: fake.url });
  await fake.server.shutdown();
  equal(outcome.ok, false);
  ok(!outcome.ok && outcome.reason.includes("1008"));
  equal(fake.subscriptions.length, 1);
});
