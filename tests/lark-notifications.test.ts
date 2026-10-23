try {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
  } as any;
} catch {}

import test from "node:test";
import assert from "node:assert/strict";

async function getModule() {
  return await import("../lib/lark-notifications");
}

const ENV_KEYS = ["LARK_APP_ID", "LARK_APP_SECRET"] as const;

test("Lark notification is skipped when app credentials are not configured", async () => {
  const { sendLarkTextNotification } = await getModule();
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    delete process.env.LARK_APP_ID;
    delete process.env.LARK_APP_SECRET;
    const result = await sendLarkTextNotification("hello", { receiveId: "oc_test", receiveIdType: "chat_id" });
    assert.deepEqual(result, { sent: false, reason: "not_configured" });
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("Lark notification obtains a token and sends text to the configured chat", async () => {
  const { resetLarkNotificationStateForTests, sendLarkTextNotification } = await getModule();
  const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  try {
    process.env.LARK_APP_ID = "cli_test";
    process.env.LARK_APP_SECRET = "secret_test";
    resetLarkNotificationStateForTests();

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("tenant_access_token")) {
        return Response.json({ code: 0, tenant_access_token: "token_test", expire: 7200 });
      }
      return Response.json({ code: 0, data: { message_id: "om_test" } });
    }) as typeof fetch;

    assert.deepEqual(await sendLarkTextNotification("Listing xong", { receiveId: "oc_test", receiveIdType: "chat_id" }), { sent: true });
    assert.equal(requests.length, 2);
    assert.match(requests[1].url, /receive_id_type=chat_id/);
    assert.equal(new Headers(requests[1].init?.headers).get("authorization"), "Bearer token_test");
    assert.deepEqual(JSON.parse(String(requests[1].init?.body)), {
      receive_id: "oc_test",
      msg_type: "text",
      content: JSON.stringify({ text: "Listing xong" }),
    });
  } finally {
    globalThis.fetch = previousFetch;
    resetLarkNotificationStateForTests();
    for (const key of ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});

test("LARK_NOTIFICATION_CATEGORIES includes mockups, listing, ppc, and accounting", async () => {
  const { LARK_NOTIFICATION_CATEGORIES } = await import("../lib/lark-notification-settings");
  assert.deepEqual([...LARK_NOTIFICATION_CATEGORIES], ["listing", "mockups", "ppc", "accounting"]);
});

