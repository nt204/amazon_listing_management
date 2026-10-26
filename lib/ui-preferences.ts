import "server-only";

import { getAppSetting, setAppSetting } from "@/lib/db";

/** Tùy chỉnh giao diện riêng của từng tài khoản (lưu trong app_settings). */
export interface UiPreferences {
  /** Sidebar nền tối có ảnh; mặc định tắt. */
  sidebarDark: boolean;
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  sidebarDark: false,
};

function uiPreferencesKey(teamId: string, userId: string) {
  return `ui_prefs:${teamId}:${userId}`;
}

export async function getUiPreferences(actor: { teamId: string; userId: string }): Promise<UiPreferences> {
  const saved = await getAppSetting<Partial<UiPreferences>>(uiPreferencesKey(actor.teamId, actor.userId));
  return {
    sidebarDark: typeof saved?.sidebarDark === "boolean" ? saved.sidebarDark : DEFAULT_UI_PREFERENCES.sidebarDark,
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
