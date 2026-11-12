import "server-only";

import { getAppSetting, setAppSetting } from "@/lib/db";

export type ManualBidChannel = "FBA" | "FBM" | "OTHER";

/** Tùy chỉnh giao diện riêng của từng tài khoản (lưu trong app_settings). */
export interface UiPreferences {
  /** Sidebar nền tối có ảnh; mặc định tắt. */
  sidebarDark: boolean;
  /** Trang mở sẵn ở tab Manual Bid (store có bảng mã FBM); mặc định FBA. */
  manualBidChannel: ManualBidChannel;
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  sidebarDark: false,
  manualBidChannel: "FBA",
};

function uiPreferencesKey(teamId: string, userId: string) {
  return `ui_prefs:${teamId}:${userId}`;
}

export async function getUiPreferences(actor: { teamId: string; userId: string }): Promise<UiPreferences> {
  const saved = await getAppSetting<Partial<UiPreferences>>(uiPreferencesKey(actor.teamId, actor.userId));
  const channel = saved?.manualBidChannel;
  return {
    sidebarDark: typeof saved?.sidebarDark === "boolean" ? saved.sidebarDark : DEFAULT_UI_PREFERENCES.sidebarDark,
    manualBidChannel: channel === "FBA" || channel === "FBM" || channel === "OTHER"
      ? channel
      : DEFAULT_UI_PREFERENCES.manualBidChannel,
  };
}

export async function saveUiPreferences(
  actor: { teamId: string; userId: string },
  patch: Partial<UiPreferences>,
): Promise<UiPreferences> {
  const next = { ...(await getUiPreferences(actor)), ...patch };
  await setAppSetting(uiPreferencesKey(actor.teamId, actor.userId), next as unknown as Record<string, unknown>);
  return next;
}
