try {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
  } as any;
} catch {}

import test, { after } from "node:test";
import assert from "node:assert/strict";

// Unreachable Redis: reaching the enqueue step rejects instead of queueing a real job.
process.env.REDIS_URL = "redis://127.0.0.1:1";
process.env.LARK_BOT_OPEN_ID = "ou_bot";

const BOT_MENTION = { key: "@_user_1", name: "AI Agent", id: { open_id: "ou_bot" } };
const MEMBER_MENTION = { key: "@_user_2", name: "Lan", id: { open_id: "ou_lan" } };

function groupEvent(text: string, mentions: unknown[]) {
  return {
    tenant_key: "t1",
    sender: { sender_type: "user", sender_id: { open_id: "ou_asker" } },
    message: {
      message_id: `om_${Math.random()}`,
      chat_id: "oc_group",
      chat_type: "group",
      message_type: "text",
      content: JSON.stringify({ text }),
      mentions,
    },
  } as any;
}

after(async () => {
  const { getRedisClient } = await import("../lib/redis");
  getRedisClient()?.disconnect();
});

async function getModule() {
  return await import("../lib/accounting/lark-webhook");
}

test("group message without any mention does not wake the agent", async () => {
  const { processLarkMessageEvent } = await getModule();
  await processLarkMessageEvent(groupEvent("doanh thu hôm nay", []));
});

test("group message tagging only another member does not wake the agent", async () => {
  const { processLarkMessageEvent } = await getModule();
  await processLarkMessageEvent(groupEvent("@_user_2 xem doanh thu hôm nay", [MEMBER_MENTION]));
});

test("group message tagging the bot is queued", async () => {
  const { processLarkMessageEvent } = await getModule();
  await assert.rejects(
    processLarkMessageEvent(groupEvent("@_user_1 doanh thu hôm nay", [BOT_MENTION])),
    /Redis chưa sẵn sàng/,
  );
});

test("messages sent by bots are ignored even when they tag the bot", async () => {
  const { processLarkMessageEvent } = await getModule();
  const event = groupEvent("@_user_1 ping", [BOT_MENTION]);
  event.sender.sender_type = "app";
  await processLarkMessageEvent(event);
});

test("only the original asker may confirm a group card action", async () => {
  const { processLarkCardAction } = await getModule();
  const result = await processLarkCardAction({
    operator: { open_id: "ou_someone_else" },
    context: { open_chat_id: "oc_group" },
    action: { value: { action: "CONFIRM_NEGATIVE", sessionId: "t1:oc_group:ou_asker" } },
  });
  assert.deepEqual(result, { status: "forbidden" });
});

test("group sessions are isolated per member", async () => {
  const { buildLarkSessionId } = await getModule();
  const base = { tenantKey: "t1", chatId: "oc_group", chatType: "group" };
  assert.notEqual(
    buildLarkSessionId({ ...base, senderId: "ou_a" }),
    buildLarkSessionId({ ...base, senderId: "ou_b" }),
  );
});

test("late Lark redelivery of an old message is not answered", async () => {
  const { processLarkMessageEvent } = await getModule();
  const event = groupEvent("@_user_1 doanh thu hôm nay", [BOT_MENTION]);
  event.message.create_time = String(Date.now() - 3 * 60 * 60 * 1000);
  // Resolves without reaching Redis: the stale message is dropped before enqueue.
  await processLarkMessageEvent(event);
});

test("recent tagged message is still queued", async () => {
  const { processLarkMessageEvent } = await getModule();
  const event = groupEvent("@_user_1 doanh thu hôm nay", [BOT_MENTION]);
  event.message.create_time = String(Date.now() - 60 * 1000);
  await assert.rejects(processLarkMessageEvent(event), /Redis chưa sẵn sàng/);
});
