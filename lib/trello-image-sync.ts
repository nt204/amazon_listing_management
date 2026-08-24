import "server-only";

import {
  listTrelloImageDerivativeReferences,
  saveTrelloImageDerivatives,
  type DataScope,
} from "@/lib/db";
import { createTrelloImageDerivatives } from "@/lib/image-processing";
import {
  downloadTrelloAttachment,
  preferredAttachmentPreview,
  selectMissingTrelloImageDerivatives,
  type TrelloAttachment,
  type TrelloCard,
} from "@/lib/trello";

type SyncState = {
  active: number;
  waiters: Array<(release: () => void) => void>;
  inFlight: Map<string, Promise<void>>;
};

const globalForTrelloImageSync = globalThis as unknown as {
  trelloImageSyncState?: SyncState;
};

function syncState() {
  if (!globalForTrelloImageSync.trelloImageSyncState) {
    globalForTrelloImageSync.trelloImageSyncState = {
      active: 0,
      waiters: [],
      inFlight: new Map(),
    };
  }
  return globalForTrelloImageSync.trelloImageSyncState;
}

function configuredConcurrency() {
  const parsed = Number(process.env.TRELLO_PREVIEW_SYNC_CONCURRENCY || 3);
  return Number.isFinite(parsed)
    ? Math.min(8, Math.max(1, Math.round(parsed)))
    : 3;
}

function configuredTimeoutMs() {
  const parsed = Number(process.env.TRELLO_PREVIEW_SYNC_TIMEOUT_MS || 45_000);
  return Number.isFinite(parsed)
    ? Math.min(120_000, Math.max(10_000, Math.round(parsed)))
    : 45_000;
}

function configuredMaxBytes() {
  const parsed = Number(process.env.TRELLO_PREVIEW_SYNC_MAX_BYTES || 20_000_000);
  return Number.isFinite(parsed)
    ? Math.min(50_000_000, Math.max(1_000_000, Math.round(parsed)))
    : 20_000_000;
}

async function acquireSyncSlot() {
  const state = syncState();
  if (state.active < configuredConcurrency()) {
    state.active += 1;
    return createRelease();
  }
  return new Promise<() => void>((resolve) => {
    state.waiters.push(resolve);
  });
}

function createRelease() {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const state = syncState();
    const next = state.waiters.shift();
    if (next) {
      next(createRelease());
      return;
    }
    state.active = Math.max(0, state.active - 1);
  };
}

function syncKey(scope: DataScope, cardId: string, attachmentId: string) {
  return `${scope.teamId}:${cardId}:${attachmentId}`;
}

export function ensureTrelloImageDerivatives(options: {
  scope: DataScope;
  cardId: string;
  attachment: TrelloAttachment;
  apiKey: string;
  token: string;
}) {
  const key = syncKey(options.scope, options.cardId, options.attachment.id);
  const state = syncState();
  const existing = state.inFlight.get(key);
  if (existing) return existing;

  const operation = (async () => {
    const release = await acquireSyncSlot();
    try {
      const sourceUrl =
        preferredAttachmentPreview(options.attachment) || options.attachment.url;
      const source = await downloadTrelloAttachment(
        sourceUrl,
        options.apiKey,
        options.token,
        configuredMaxBytes(),
        AbortSignal.timeout(configuredTimeoutMs()),
      );
      const derivatives = await createTrelloImageDerivatives(source);
      await saveTrelloImageDerivatives(
        options.scope,
        options.cardId,
        options.attachment.id,
        derivatives,
      );
    } finally {
      release();
    }
  })().finally(() => {
    state.inFlight.delete(key);
  });

  state.inFlight.set(key, operation);
  return operation;
}

export async function syncMissingTrelloImageDerivatives(options: {
  scope: DataScope;
  cards: readonly TrelloCard[];
  apiKey: string;
  token: string;
}) {
  const references = await listTrelloImageDerivativeReferences(
    options.scope,
    options.cards.map((card) => card.id),
  );
  const missing = selectMissingTrelloImageDerivatives(
    options.cards,
    references,
  );
  if (missing.length === 0) {
    return { requested: 0, succeeded: 0, failed: 0 };
  }

  const results = await Promise.allSettled(
    missing.map(({ card, attachment }) =>
      ensureTrelloImageDerivatives({
        scope: options.scope,
        cardId: card.id,
        attachment,
        apiKey: options.apiKey,
        token: options.token,
      }),
    ),
  );
  const failed = results.filter((result) => result.status === "rejected").length;
  return {
    requested: missing.length,
    succeeded: missing.length - failed,
    failed,
  };
}
