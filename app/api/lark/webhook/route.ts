import * as lark from "@larksuiteoapi/node-sdk";
import {
  cardActionToast,
  processLarkCardAction,
  processLarkMessageEvent,
} from "@/lib/accounting/lark-webhook";

export const runtime = "nodejs";
export const maxDuration = 60;

function webhookCredentials() {
  return {
    verificationToken: process.env.LARK_VERIFICATION_TOKEN?.trim() || "",
    encryptKey: process.env.LARK_ENCRYPT_KEY?.trim() || "",
  };
}

function requestData(body: Record<string, unknown>, request: Request) {
  // The Lark SDK intentionally reads callback headers from the prototype so
  // JSON.stringify(data) still matches the signed body.
  return Object.assign(
    Object.create({ headers: Object.fromEntries(request.headers.entries()) }),
    body,
  );
}

export async function POST(request: Request) {
  const credentials = webhookCredentials();
  if (!credentials.verificationToken) {
    console.error("[LarkWebhook] Thiếu LARK_VERIFICATION_TOKEN.");
    return Response.json({ code: 1, msg: "Webhook is not configured" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ code: 1, msg: "Invalid JSON" }, { status: 400 });
  }

  const data = requestData(body, request);

  // Lark calls this while the callback URL is being saved in the console.
  try {
    const challenge = lark.generateChallenge(data, credentials);
    if (challenge.isChallenge) return Response.json(challenge.challenge);
  } catch {
    return Response.json({ code: 1, msg: "Webhook verification failed" }, { status: 403 });
  }

  const isCardAction =
    body.type === "card.action.trigger" ||
    (body.header as { event_type?: string } | undefined)?.event_type === "card.action.trigger" ||
    Boolean(body.action);

  if (isCardAction) {
    const cardHandler = new lark.CardActionHandler(credentials, async (event: unknown) => {
      return cardActionToast(
        await processLarkCardAction(event as Parameters<typeof processLarkCardAction>[0]),
      );
    });
    const result = await cardHandler.invoke(data);
    if (result === undefined) {
      return Response.json({ code: 1, msg: "Webhook verification failed" }, { status: 403 });
    }
    return Response.json(result);
  }

  const dispatcher = new lark.EventDispatcher(credentials).register({
    "im.message.receive_v1": async (event: unknown) => {
      const typedEvent = event as Parameters<typeof processLarkMessageEvent>[0];
      await processLarkMessageEvent(typedEvent);
      return { code: 0 };
    },
    // Encrypted v2 card callbacks cannot be identified until the SDK decrypts
    // them, so they are also registered on the generic event dispatcher.
    "card.action.trigger": async (event: unknown) => {
      return cardActionToast(
        await processLarkCardAction(event as Parameters<typeof processLarkCardAction>[0]),
      );
    },
  });

  const result = await dispatcher.invoke(data);
  if (result === undefined) {
    return Response.json({ code: 1, msg: "Webhook verification failed" }, { status: 403 });
  }

  // Unknown authenticated events are acknowledged so Lark does not retry them.
  return Response.json(typeof result === "string" ? { code: 0 } : result);
}
