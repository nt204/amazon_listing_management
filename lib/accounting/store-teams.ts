// Team quản lý của store lưu dạng chuỗi "FBA 3 / FBM" (thuần, dùng chung server + client).

export function parseStoreTeams(team: string | null | undefined): string[] {
  return (team || "")
    .split(/[\/,]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function storeHasTeam(team: string | null | undefined, target: string): boolean {
  const key = target.trim().toUpperCase();
  return parseStoreTeams(team).some((t) => t.toUpperCase() === key);
}

/** Danh sách team duy nhất, sắp theo tên ("FBA 1", "FBA 2", …, "FBM"). */
export function listTeams(stores: { team?: string | null }[]): string[] {
  const teams = new Set(stores.flatMap((s) => parseStoreTeams(s.team)));
  return [...teams].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Store có ít nhất 1 team FBA ("FBA 1", "FBA 2"...). */
export function storeHasFbaTeam(team: string | null | undefined): boolean {
  return parseStoreTeams(team).some((t) => /^fba\b/i.test(t));
}

type WithAccess = { access?: { channels: string[]; editChannels: string[] } };

/** Người đang xem được xem kênh này của store (store không kèm access = toàn quyền). */
export function storeCanView(store: object | null | undefined, channel: "FBA" | "FBM"): boolean {
  const access = (store as WithAccess | null | undefined)?.access;
  return !access || access.channels.includes(channel);
}

/** Người đang xem được sửa (kênh này / bất kỳ kênh nào) của store. */
export function storeCanEdit(store: object | null | undefined, channel?: "FBA" | "FBM"): boolean {
  const access = (store as WithAccess | null | undefined)?.access;
  if (!access) return true;
  return channel ? access.editChannels.includes(channel) : access.editChannels.length > 0;
}
