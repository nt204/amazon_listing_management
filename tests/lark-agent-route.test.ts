try {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = { id: serverOnlyPath, filename: serverOnlyPath, loaded: true, exports: {} } as any;
} catch {}

import test from "node:test";
import assert from "node:assert/strict";

async function post(body: unknown) {
  const { POST } = await import("../app/api/accounting/lark-agent/route");
  const request = new Request("http://localhost/api/accounting/lark-agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request as any);
}

test("hỏi trực tiếp không đăng nhập bị từ chối (không chạy bot với quyền mọi store)", async () => {
  // Như production: bắt buộc đăng nhập, không tự dùng tài khoản dev
  const env = process.env as Record<string, string | undefined>;
  const previous = { mode: env.LISTING_DESK_AUTH_MODE, nodeEnv: env.NODE_ENV };
  env.LISTING_DESK_AUTH_MODE = "required";
  env.NODE_ENV = "production";
  try {
    const res = await post({ message: "Revenue tất cả store tháng này" });
    assert.equal(res.status, 401);
  } finally {
    for (const [key, value] of [["LISTING_DESK_AUTH_MODE", previous.mode], ["NODE_ENV", previous.nodeEnv]] as const) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
});

test("sự kiện Lark giả (sai verification token) bị chặn ở URL cũ", async () => {
  const previous = process.env.LARK_VERIFICATION_TOKEN;
  process.env.LARK_VERIFICATION_TOKEN = "real-token";
  try {
    const res = await post({
      schema: "2.0",
      header: { event_type: "im.message.receive_v1", token: "forged", event_id: "e1", create_time: String(Date.now()) },
      event: {
        sender: { sender_id: { open_id: "ou_admin" }, sender_type: "user" },
        message: { message_id: "om_1", chat_type: "p2p", chat_id: "oc_1", message_type: "text", content: JSON.stringify({ text: "xác nhận" }) },
      },
    });
    assert.equal(res.status, 403);
  } finally {
    if (previous === undefined) delete process.env.LARK_VERIFICATION_TOKEN;
    else process.env.LARK_VERIFICATION_TOKEN = previous;
  }
});

test("bấm nút giả (card action sai token) bị chặn ở URL cũ", async () => {
  const previous = process.env.LARK_VERIFICATION_TOKEN;
  process.env.LARK_VERIFICATION_TOKEN = "real-token";
  try {
    const res = await post({
      token: "forged",
      open_id: "ou_admin",
      action: { value: { action: "CONFIRM_ACTION", sessionId: "s1" } },
    });
    assert.equal(res.status, 403);
  } finally {
    if (previous === undefined) delete process.env.LARK_VERIFICATION_TOKEN;
    else process.env.LARK_VERIFICATION_TOKEN = previous;
  }
});
