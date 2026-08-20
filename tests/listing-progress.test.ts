import assert from "node:assert/strict";
import test from "node:test";
import { readNdjsonStream } from "../lib/read-ndjson-stream";
import { runWithConcurrency } from "../lib/run-with-concurrency";

test("NDJSON progress reader handles events split across response chunks", async () => {
  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('{"type":"progress","progress":4}\n{"type":"listing'));
      controller.enqueue(encoder.encode('_ready","progress":84}\n'));
      controller.close();
    },
  }));
  const events: Array<{ type: string; progress: number }> = [];

  await readNdjsonStream(response, (event) => events.push(event as { type: string; progress: number }));

  assert.deepEqual(events, [
    { type: "progress", progress: 4 },
    { type: "listing_ready", progress: 84 },
  ]);
});

test("batch worker pool never processes more than two cards concurrently", async () => {
  let active = 0;
  let maximumActive = 0;
  const completed: number[] = [];

  await runWithConcurrency([0, 1, 2, 3, 4], 2, async (item) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    completed.push(item);
    active -= 1;
  });

  assert.equal(maximumActive, 2);
  assert.deepEqual(completed.sort((a, b) => a - b), [0, 1, 2, 3, 4]);
});
