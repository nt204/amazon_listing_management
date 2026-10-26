import { z } from "zod";

import { ApiError, authorize, dataScope, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import {
  getLarkSettings,
  savePersonalLarkSettings,
  saveTeamLarkSettings,
} from "@/lib/lark-notification-settings";
import { sendLarkTextNotification } from "@/lib/lark-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const categories = ["listing", "mockups", "ppc", "accounting"] as const;

function allowedCategories(actor: Awaited<ReturnType<typeof authorize>>) {
  const allowed = new Set(actor.allowedFeatures || categories);
  const filtered = categories.filter((category) => allowed.has(category));
  return filtered.length > 0 ? filtered : [...categories];
}

const categoryRulesSchema = z.object({
  listing: z.boolean().default(false),
  mockups: z.boolean().default(false),
  ppc: z.boolean().default(false),
  accounting: z.boolean().default(false),
});

const teamRulesSchema = z.object({
  listing: z.object({ enabled: z.boolean(), channelId: z.string() }).default({ enabled: false, channelId: "" }),
  mockups: z.object({ enabled: z.boolean(), channelId: z.string() }).default({ enabled: false, channelId: "" }),
  ppc: z.object({ enabled: z.boolean(), channelId: z.string() }).default({ enabled: false, channelId: "" }),
  accounting: z.object({ enabled: z.boolean(), channelId: z.string() }).default({ enabled: false, channelId: "" }),
});

const channelItemSchema = z.object({
  id: z.string().max(50),
  name: z.string().trim().max(80),
  chatId: z.string().trim(),
  enabled: z.boolean(),
  categories: categoryRulesSchema.partial().default({}),
});

const saveSchema = z.object({
  personal: z.object({
    receiveId: z.string().trim().max(255),
    receiveIdType: z.enum(["email", "open_id", "user_id"]),
    enabled: z.boolean(),
  }),
  personalRules: categoryRulesSchema.partial().default({}),
  channels: z.array(channelItemSchema).max(20).default([]),
  teamRules: teamRulesSchema.partial().optional(),
});

function validatePersonalTarget(receiveId: string, receiveIdType: string, enabled: boolean) {
  if (!enabled) return;
  if (!receiveId) throw new ApiError("Vui lòng nhập địa chỉ Lark cá nhân.", 400);
  if (receiveIdType === "email" && !z.string().email().safeParse(receiveId).success) {
    throw new ApiError("Email Lark không hợp lệ. Vui lòng nhập đúng định dạng email.", 400);
  }
  if (receiveIdType === "open_id" && !receiveId.startsWith("ou_")) {
    throw new ApiError("Lark open_id phải bắt đầu bằng ou_.", 400);
  }
}

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read");
    return Response.json({
      success: true,
      isAdmin: actor.role === "admin",
      allowedCategories: allowedCategories(actor),
      ...(await getLarkSettings(dataScope(actor))),
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải cài đặt Lark.", 500);
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await authorize(request, "write");
    enforceRequestSize(request, 50_000);
    const input = saveSchema.parse(await request.json());
    validatePersonalTarget(input.personal.receiveId, input.personal.receiveIdType, input.personal.enabled);
    const existing = await getLarkSettings(dataScope(actor));
    const allowed = new Set(allowedCategories(actor));
    const personalRules = { ...existing.personalRules };
    for (const category of categories) {
      if (!allowed.has(category)) continue;
      if (input.personalRules && category in input.personalRules) {
        personalRules[category] = Boolean(input.personalRules[category]);
      }
    }
    await savePersonalLarkSettings(dataScope(actor), input.personal, personalRules);
    if (actor.role === "admin") {
      const validChannels = input.channels.filter((c) => c.name.trim() || c.chatId.trim());
      for (const channel of validChannels) {
        if (!channel.name.trim()) {
          throw new ApiError("Tên kênh nhóm không được để trống.", 400);
        }
        if (!channel.chatId.startsWith("oc_")) {
          throw new ApiError(`Chat ID của nhóm "${channel.name}" phải bắt đầu bằng oc_.`, 400);
        }
      }
      await saveTeamLarkSettings(
        dataScope(actor),
        validChannels.map((c) => ({
          id: c.id,
          name: c.name,
          chatId: c.chatId,
          enabled: c.enabled,
          categories: {
            listing: Boolean(c.categories?.listing),
            mockups: Boolean(c.categories?.mockups),
            ppc: Boolean(c.categories?.ppc),
            accounting: Boolean(c.categories?.accounting),
          },
        })),
      );
    }
    return Response.json({
      success: true,
      isAdmin: actor.role === "admin",
      allowedCategories: allowedCategories(actor),
      ...(await getLarkSettings(dataScope(actor))),
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể lưu cài đặt Lark.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write");
    enforceRequestSize(request, 10_000);
    const body = z.object({
      target: z.enum(["personal", "channel"]),
      channelId: z.string().optional(),
      receiveId: z.string().optional(),
      receiveIdType: z.enum(["email", "open_id", "user_id"]).optional(),
    }).parse(await request.json());

    let recipient: { receiveId: string; receiveIdType: string };
    if (body.target === "personal") {
      const existing = await getLarkSettings(dataScope(actor));
      const receiveId = (body.receiveId ?? existing.personal.receiveId).trim();
      const receiveIdType = body.receiveIdType ?? existing.personal.receiveIdType ?? "email";
      if (!receiveId) throw new ApiError("Vui lòng nhập địa chỉ Lark cá nhân để gửi thử.", 400);
      validatePersonalTarget(receiveId, receiveIdType, true);
      recipient = { receiveId, receiveIdType };
    } else {
      if (actor.role !== "admin") throw new ApiError("Chỉ admin được phép thử kênh nhóm.", 403);
      const settings = await getLarkSettings(dataScope(actor));
      const channel = settings.channels.find((item) => item.id === body.channelId);
      if (!channel) throw new ApiError("Không tìm thấy kênh nhóm để gửi thử.", 404);
      recipient = { receiveId: channel.chatId, receiveIdType: "chat_id" };
    }

    const testMessage =
      body.target === "personal" && recipient.receiveIdType === "email"
        ? `👋 Xin chào ${actor.displayName}!\n\nĐây là tin nhắn thử nghiệm từ NCE HUB.\n\n👉 Để kích hoạt quyền hỏi đáp dữ liệu Store với bot, bạn chỉ cần trả lời ngay tin nhắn này theo cú pháp:\n**kết nối ${recipient.receiveId}**`
        : `Tin nhắn thử từ NCE HUB\nTài khoản: ${actor.displayName}`;

    await sendLarkTextNotification(testMessage, recipient);
    return Response.json({ success: true, message: "Đã gửi tin nhắn thử thành công qua Lark!" });
  } catch (error) {
    return routeErrorResponse(error, "Không thể gửi tin nhắn thử.", 500);
  }
}
