import crypto from "node:crypto";
import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { withKwPlus } from "@/lib/ppc/campaign-launch";
import { objectStorageDriver, putStoredObject, r2KeyPrefix } from "@/lib/object-storage";
import { assertActorPpcStoreActionAccess } from "@/lib/ppc/store-user-access";
import { findExistingCampaigns, listNewCampSkus, getKwFile, listKwFilesByName, rememberUploadedCampaigns, saveKwFile } from "@/lib/ppc/new-camp-db";
import {
  NewCampInputError,
  applyNameEdits,
  buildCampaignZip,
  combineGeneratedFiles,
  writeCombinedXlsx,
  planCampaigns,
  createKeywordWorkbook,
  createKeywordWorkbookParts,
  parseKeywordFile,
  generateAllFiles,
  needsKeywordFile,
  parseAsinWorkbook,
  parseKeywordWorkbook,
  type KeywordPart,
  type MatchRunForm,
  type NewCampForm,
  type NewCampSkuInfo,
} from "@/lib/ppc/new-camp-generator";
import {
  BIDDING_STRATEGIES,
  DEFAULT_ADVANCED,
  NAME_FIELDS,
  SB_FIELDS,
  SB_FIELD_LABELS,
  missingSbFields,
  type AdvancedOptions,
  type BiddingStrategy,
  type NameField,
  type SbField,
  type SbOverrides,
} from "@/lib/ppc/new-camp-fields";

export const runtime = "nodejs";

const MAX_INPUT_FILE_BYTES = 10 * 1024 * 1024;

function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v);
}

function matchRun(raw: Record<string, unknown> | undefined): MatchRunForm {
  return {
    run: raw?.run === true,
    exact: raw?.exact === true,
    phrase: raw?.phrase === true,
    broad: raw?.broad === true,
    dailyBudget: str(raw?.dailyBudget),
  };
}

type RawForm = Record<string, unknown> & {
  sp03?: Record<string, unknown>;
  sb01?: Record<string, unknown>;
  sb05?: Record<string, unknown>;
  sp04?: Record<string, unknown>;
  flasin?: Record<string, unknown>;
};

function parseForm(raw: RawForm): NewCampForm {
  const skus = Array.isArray(raw?.selectedSkus) ? raw.selectedSkus.map((s: unknown) => str(s).trim()).filter(Boolean) : [];
  return {
    loaiHinh: raw?.loaiHinh === "FBA" ? "FBA" : "FBM",
    trangThai: raw?.trangThai === "Win" ? "Win" : raw?.trangThai === "Auto" ? "Auto" : "Test",
    ngay: str(raw?.ngay).trim(),
    selectedSkus: [...new Set<string>(skus)],
    sp03: matchRun(raw?.sp03),
    sb01: matchRun(raw?.sb01),
    sb05: matchRun(raw?.sb05),
    sp04: {
      run: raw?.sp04?.run === true,
      dailyBudget: str(raw?.sp04?.dailyBudget),
      bidClose: str(raw?.sp04?.bidClose),
      bidLoose: str(raw?.sp04?.bidLoose),
      bidComp: str(raw?.sp04?.bidComp),
      bidSub: str(raw?.sp04?.bidSub),
    },
    flasin: { run: raw?.flasin?.run === true, dailyBudget: str(raw?.flasin?.dailyBudget), bid: str(raw?.flasin?.bid) },
  };
}

async function fileBytes(value: FormDataEntryValue | null, label: string): Promise<Buffer | null> {
  if (!value || typeof value === "string" || value.size === 0) return null;
  if (value.size > MAX_INPUT_FILE_BYTES) throw new ApiError(`${label} quá lớn (tối đa 10 MB).`, 413);
  return Buffer.from(await value.arrayBuffer());
}

/** Thông tin SB người dùng điền bổ sung cho SKU thiếu (chỉ dùng cho file lần này). */
function parseSbOverrides(raw: unknown): SbOverrides {
  const out: SbOverrides = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [sku, fields] of Object.entries(raw as Record<string, unknown>)) {
    if (!fields || typeof fields !== "object") continue;
    const clean: Partial<Record<SbField, string>> = {};
    for (const field of SB_FIELDS) {
      const value = str((fields as Record<string, unknown>)[field]).replace(/[\r\n\t]+/g, " ").trim().slice(0, 2000);
      if (value) clean[field] = value;
    }
    if (Object.keys(clean).length) out[sku.trim().toUpperCase()] = clean;
  }
  return out;
}

/** Phôi / Ngách / PIC sửa tay cho từng SKU (chỉ dùng cho tên camp lần này). */
function parseNameOverrides(raw: unknown): Record<string, Partial<Record<NameField, string>>> {
  const out: Record<string, Partial<Record<NameField, string>>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [sku, fields] of Object.entries(raw as Record<string, unknown>)) {
    if (!fields || typeof fields !== "object") continue;
    const clean: Partial<Record<NameField, string>> = {};
    for (const field of NAME_FIELDS) {
      const v = (fields as Record<string, unknown>)[field];
      if (typeof v === "string") clean[field] = v.replace(/[\r\n\t]+/g, " ").trim().slice(0, 200);
    }
    if (Object.keys(clean).length) out[sku.trim().toUpperCase()] = clean;
  }
  return out;
}

function parseNameEdits(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[key] = v.replace(/[\r\n\t]+/g, " ").trim().slice(0, 255);
  }
  return out;
}

function parseAdvanced(raw: unknown): AdvancedOptions {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const strategy = (v: unknown, fallback: BiddingStrategy) =>
    (BIDDING_STRATEGIES as readonly string[]).includes(String(v)) ? (String(v) as BiddingStrategy) : fallback;
  const pct = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n <= 300 ? n : fallback;
  };
  const bid = str(r.adGroupDefaultBid).trim();
  if (bid && !(Number(bid) > 0)) throw new ApiError("Default bid Ad Group không hợp lệ.", 400);
  return {
    sp03BiddingStrategy: strategy(r.sp03BiddingStrategy, DEFAULT_ADVANCED.sp03BiddingStrategy),
    sp04BiddingStrategy: strategy(r.sp04BiddingStrategy, DEFAULT_ADVANCED.sp04BiddingStrategy),
    adGroupDefaultBid: bid,
    phrasePct: pct(r.phrasePct, DEFAULT_ADVANCED.phrasePct),
    broadPct: pct(r.broadPct, DEFAULT_ADVANCED.broadPct),
  };
}

function asciiFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._ -]+/g, "_");
}

/** Chữ ký nội dung keyword (tên part + keyword + bid) để so 2 file có cùng bộ keyword hay không. */
function keywordSignature(parts: KeywordPart[]): string {
  const cell = (v: unknown) => (typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v ?? "").trim());
  return JSON.stringify(parts.map((p) => [p.name.trim(), p.keywords.map(cell), p.bids.map(cell)]));
}

/** File cùng tên + cùng nội dung keyword đã có trong kho → trả ID của nó (bấm Tạo file nhiều lần không lưu trùng). */
async function findSameKwFile(teamId: string, fileName: string, parts: KeywordPart[]): Promise<number | null> {
  const target = keywordSignature(parts);
  for (const f of await listKwFilesByName(teamId, fileName)) {
    try {
      if (keywordSignature((await parseKeywordFile(f.data)).parts) === target) return f.id;
    } catch {
      // file cũ không đọc được → bỏ qua, coi như khác
    }
  }
  return null;
}

/**
 * POST multipart: options (JSON), kwMode (upload | library | create | none),
 * keyword_file, kwFileId, kwName (JSON {user, niche, phoi, set}), kwList / bidList (JSON), asin_file.
 * Trả về file zip; thông báo lưu file keyword nằm ở header X-Upload-Status / X-Upload-Message.
 * mode=preview: không tạo file, không lưu kho — trả JSON danh sách camp sẽ tạo (để xem trước / sửa tên).
 * output=upload + storeId: lưu từng file lên R2 và xếp job cho Mac mini upload lên Amazon (AdsPower).
 */
export async function POST(request: Request) {
  let uploadStatus: "success" | "error" | null = null;
  let uploadMessage: string | null = null;
  const withUploadHeaders = (response: Response) => {
    if (uploadStatus && uploadMessage) {
      response.headers.set("X-Upload-Status", uploadStatus);
      response.headers.set("X-Upload-Message", encodeURIComponent(uploadMessage));
    }
    return response;
  };

  try {
    const formData = await request.formData();
    const preview = str(formData.get("mode")) === "preview";
    const output = str(formData.get("output"));
    const actor = await authorize(request, output === "upload" ? "write" : "export", "ppc");
    enforceRequestSize(request, 25_000_000);

    let rawOptions: RawForm;
    try {
      rawOptions = JSON.parse(str(formData.get("options")) || "{}");
    } catch {
      throw new ApiError("Dữ liệu form không hợp lệ.", 400);
    }
    const form = parseForm(rawOptions);
    const naming = (rawOptions.naming && typeof rawOptions.naming === "object" ? rawOptions.naming : {}) as Record<string, unknown>;
    form.naming = { suffix: str(naming.suffix).replace(/\s+/g, " ").trim().slice(0, 80), collapseSpaces: naming.collapseSpaces === true };
    form.advanced = parseAdvanced(rawOptions.advanced);
    if (form.selectedSkus.length === 0) throw new ApiError("Vui lòng chọn ít nhất một SKU.", 400);

    // Upload: SKU thuộc store nào trong Bảng mã thì upload vào store PPC cùng tên. Kiểm tra store / quyền / R2
    // trước mọi bước (không lưu kho, không tạo file nếu không upload được).
    const uploadStoreOf = new Map<string, { id: string; name: string }>(); // SKU (viết hoa) → store PPC
    if (output === "upload" && !preview) {
      if (objectStorageDriver() !== "r2") throw new ApiError("Upload tự động cần OBJECT_STORAGE_DRIVER=r2 (chỉ có trên server).", 400);
      const sql = await getDatabaseClient();
      const ppcStores = await sql<{ id: string; name: string }[]>`SELECT id, name FROM ppc_stores WHERE team_id = ${actor.teamId}`;
      const ppcByName = new Map(ppcStores.map((st) => [st.name.trim().toUpperCase(), st]));
      const skuStore = new Map((await listNewCampSkus(form.loaiHinh)).map((x) => [x.sku.toUpperCase(), (x.storeName || "").trim()]));
      const noStore: string[] = [];
      for (const sku of form.selectedSkus) {
        const storeName = skuStore.get(sku.toUpperCase()) || "";
        const st = ppcByName.get(storeName.toUpperCase());
        if (st) uploadStoreOf.set(sku.toUpperCase(), st);
        else noStore.push(`${sku}${storeName ? ` (store ${storeName} chưa có trong PPC)` : " (không có store trong Bảng mã)"}`);
      }
      if (noStore.length) throw new ApiError(`Không xác định được store để upload:\n${noStore.slice(0, 10).join("\n")}`, 400);
      for (const st of new Map([...uploadStoreOf.values()].map((x) => [x.id, x])).values()) {
        await assertActorPpcStoreActionAccess(actor.teamId, actor.userId, st.id);
      }
    }

    // --- File keyword: 3 cách như tool cũ ---
    const kwMode = str(formData.get("kwMode"));
    let kwBuffer: Buffer | null = null;
    let pendingSaveName: string | null = null;
    if (kwMode === "upload" || kwMode === "create") {
      let names: Record<string, unknown> = {};
      try {
        names = JSON.parse(str(formData.get("kwName")) || "{}");
      } catch { /* kiểm tra bên dưới */ }
      const parts = [names.user, names.niche, names.phoi, names.set].map((v) => str(v).trim());
      if (!preview && parts.some((p) => !p)) throw new ApiError("Vui lòng điền đủ 4 mục Tên người, Ngách, Phôi, Bộ KW.", 400);
      const newFileName = `${parts.join(" - ")}.xlsx`;

      if (kwMode === "upload") {
        kwBuffer = await fileBytes(formData.get("keyword_file"), "File keyword");
        if (!kwBuffer) throw new ApiError("Không tìm thấy file upload cho chức năng 'Tạo từ file upload'.", 400);
      } else if (formData.get("kwParts")) {
        // Tạo mới nhiều part: [{ name, keywords[], bids[] }]
        let raw: unknown;
        try {
          raw = JSON.parse(str(formData.get("kwParts")));
        } catch {
          throw new ApiError("Dữ liệu keyword không hợp lệ.", 400);
        }
        const kwParts = (Array.isArray(raw) ? raw : []).map((p: Record<string, unknown>, i: number) => {
          const keywords = (Array.isArray(p?.keywords) ? p.keywords : []).map(str).map((k: string) => k.trim()).filter(Boolean);
          const bids = (Array.isArray(p?.bids) ? p.bids : []).map(str);
          return { name: str(p?.name).trim().slice(0, 120) || `Part ${String(i + 1).padStart(2, "0")}`, keywords, bids: keywords.map((_: string, j: number) => bids[j] ?? "") };
        });
        if (!kwParts.some((p) => p.keywords.length)) throw new ApiError("Chưa có keyword nào.", 400);
        kwBuffer = await createKeywordWorkbookParts(kwParts);
      } else {
        let kwList: unknown, bidList: unknown;
        try {
          kwList = JSON.parse(str(formData.get("kwList")) || "[]");
          bidList = JSON.parse(str(formData.get("bidList")) || "[]");
        } catch {
          throw new ApiError("Dữ liệu keyword hoặc bid không hợp lệ.", 400);
        }
        if (!Array.isArray(kwList) || !Array.isArray(bidList) || kwList.length === 0 || kwList.length !== bidList.length) {
          throw new ApiError("Dữ liệu keyword hoặc bid không hợp lệ.", 400);
        }
        kwBuffer = await createKeywordWorkbook(kwList.map(str), bidList.map(str));
      }

      if (!preview) pendingSaveName = newFileName;
    } else if (kwMode === "library") {
      const id = Number(formData.get("kwFileId"));
      const file = Number.isInteger(id) && id > 0 ? await getKwFile(actor.teamId, id) : null;
      if (!file) throw new ApiError(`Không tìm thấy file keyword ID ${str(formData.get("kwFileId"))} trong kho.`, 400);
      kwBuffer = file.data;
    }

    let keywordParts: KeywordPart[] | null = null;
    let kwParseError: string | null = null;
    if (kwBuffer) {
      try {
        const parsed = await parseKeywordFile(kwBuffer);
        keywordParts = parsed.parts;
        // File không theo mẫu (CSV, mỗi sheet 1 part...) → chuẩn hoá về "Chia Part test" để lưu kho / dùng lại
        if (parsed.format !== "chia-part" && keywordParts.length) {
          kwBuffer = await createKeywordWorkbookParts(
            keywordParts.map((p) => ({ name: p.name, keywords: p.keywords.map(String), bids: p.bids.map((b) => (typeof b === "number" && Number.isFinite(b) ? b : "")) })),
          );
          keywordParts = await parseKeywordWorkbook(kwBuffer);
        }
      } catch (error) {
        kwParseError = error instanceof Error ? error.message : String(error);
      }
    }
    // File mới (upload / tạo từ list) chỉ lưu vào kho khi đọc được keyword, tránh kho có file hỏng.
    if (pendingSaveName && kwBuffer) {
      if (keywordParts && keywordParts.length > 0) {
        try {
          const existingId = await findSameKwFile(actor.teamId, pendingSaveName, keywordParts);
          if (existingId) {
            uploadStatus = "success";
            uploadMessage = `File keyword '${pendingSaveName}' đã có sẵn trong kho (ID: ${existingId}), không lưu thêm bản trùng.`;
          } else {
            const id = await saveKwFile(actor.teamId, actor.userId, pendingSaveName, kwBuffer);
            uploadStatus = "success";
            uploadMessage = `File keyword '${pendingSaveName}' đã được lưu vào kho thành công (ID: ${id}).`;
          }
        } catch (error) {
          uploadStatus = "error";
          uploadMessage = `Lỗi khi lưu file keyword '${pendingSaveName}': ${error instanceof Error ? error.message : String(error)}`;
        }
      } else {
        uploadStatus = "error";
        uploadMessage = `File keyword '${pendingSaveName}' không được lưu vào kho vì không đọc được keyword${kwParseError ? `: ${kwParseError}` : "."}`;
      }
    }
    // KW plus: chỉ thêm khi lên camp, file trong kho giữ nguyên
    if (rawOptions.kwPlus === true && keywordParts) {
      keywordParts = keywordParts.map((p) => {
        const rows = withKwPlus(
          p.keywords.map((kw, i) => ({ kw, bid: p.bids[i] ?? "" })),
          (r) => String(r.kw),
          (r, plus) => ({ kw: plus, bid: r.bid }),
        );
        return { ...p, keywords: rows.map((r) => r.kw), bids: rows.map((r) => r.bid) };
      });
    }
    const kwMissing = needsKeywordFile(form) && (!keywordParts || keywordParts.length === 0);
    if (kwMissing && !preview) {
      const base = "Đã chọn chạy campaign Keyword nhưng file Keyword ";
      throw new ApiError(
        !kwBuffer
          ? `${base}chưa được chọn hoặc không hợp lệ.`
          : `${base}bị lỗi khi đọc dữ liệu${kwParseError ? `: ${kwParseError}` : ". Kiểm tra định dạng file."}`,
        400,
      );
    }

    // --- File ASIN cho FL Asin ---
    let asins: string[] = [];
    if (form.flasin.run && preview) {
      // Xem trước: tên camp FL Asin không phụ thuộc danh sách ASIN
      asins = ["preview"];
    } else if (form.flasin.run) {
      const asinBuffer = await fileBytes(formData.get("asin_file"), "File ASIN");
      if (!asinBuffer) throw new ApiError("Đã chọn chạy FL Asin nhưng không upload file ASIN.", 400);
      try {
        asins = await parseAsinWorkbook(asinBuffer);
      } catch (error) {
        throw new ApiError(error instanceof Error ? error.message : "File ASIN đọc bị lỗi.", 400);
      }
      if (asins.length === 0) throw new ApiError("File ASIN không có dữ liệu hoặc đọc bị lỗi.", 400);
    }

    // --- Thông tin SKU từ BẢNG MÃ ---
    const all = await listNewCampSkus(form.loaiHinh);
    const byUpper = new Map(all.map((s) => [s.sku.toUpperCase(), s]));
    const infos = new Map<string, NewCampSkuInfo>();
    const overrides = parseSbOverrides(rawOptions.sbOverrides);
    const nameOverrides = parseNameOverrides(rawOptions.nameOverrides);
    form.selectedSkus = [...new Set(form.selectedSkus.map((sku) => byUpper.get(sku.toUpperCase())?.sku ?? sku))];
    for (const sku of form.selectedSkus) {
      const info = byUpper.get(sku.toUpperCase());
      if (!info) continue;
      infos.set(sku, { ...info, ...overrides[sku.toUpperCase()], ...nameOverrides[sku.toUpperCase()] });
    }

    const plan = planCampaigns(form, infos, keywordParts, asins.length);
    if (preview) {
      const existing = await findExistingCampaigns(actor.teamId, plan.map((c) => c.name)).catch(() => ({}));
      return Response.json(
        { success: true, campaigns: plan, kwMissing, kwError: kwParseError, existing },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    // SB thiếu trường bắt buộc: tải file vẫn được, upload tự động thì chặn (Amazon từ chối camp).
    const runs = { sb01: form.sb01.run && !!keywordParts?.length, sb05: form.sb05.run && !!keywordParts?.length };
    if (output === "upload" && (runs.sb01 || runs.sb05)) {
      const lines = [...infos.entries()]
        .map(([sku, info]) => ({ sku, missing: missingSbFields(info, undefined, runs) }))
        .filter((r) => r.missing.length > 0)
        .map((r) => `${r.sku}: ${r.missing.map((f) => SB_FIELD_LABELS[f]).join(", ")}`);
      if (lines.length) {
        throw new ApiError(`Còn ${lines.length} SKU thiếu thông tin SB nên không upload tự động được (tải file vẫn được):\n${lines.slice(0, 20).join("\n")}${lines.length > 20 ? "\n…" : ""}`, 400);
      }
    }

    const files = generateAllFiles(form, infos, keywordParts, asins);
    if (files.length === 0) throw new ApiError("Không có file nào được tạo. Kiểm tra lại lựa chọn và file input.", 400);

    // Tên camp sửa tay (theo mã camp); tên trùng nhau thì Amazon gộp nhầm camp → chặn.
    const nameEdits = parseNameEdits(rawOptions.nameEdits);
    const finalNames = plan.map((c) => nameEdits[c.key]?.replace(/\s+/g, " ").trim() || c.name);
    const dup = finalNames.find((n, i) => finalNames.indexOf(n) !== i);
    if (dup) throw new ApiError(`Tên camp bị trùng: "${dup}". Sửa lại để mỗi camp một tên.`, 400);
    applyNameEdits(files, plan, nameEdits);

    // Tên đã có trên Amazon (snapshot PPC / vừa upload) → Amazon từ chối camp trùng tên
    const existing = await findExistingCampaigns(actor.teamId, finalNames);
    const existingNames = Object.keys(existing);
    if (existingNames.length) {
      throw new ApiError(
        `${existingNames.length} camp đã có trên Amazon, đổi tên (vd thêm đuôi tên) rồi tạo lại:\n${existingNames
          .slice(0, 10)
          .map((n) => `• ${n} (${existing[n].store})`)
          .join("\n")}${existingNames.length > 10 ? "\n…" : ""}`,
        400,
      );
    }

    // Upload thẳng lên Amazon: tách theo store của SKU, mỗi store sinh file riêng, mỗi file 1 job (Mac mini + AdsPower)
    if (uploadStoreOf.size) {
      const sql = await getDatabaseClient();
      const groups = new Map<string, { store: { id: string; name: string }; skus: string[] }>();
      for (const sku of form.selectedSkus) {
        const st = uploadStoreOf.get(sku.toUpperCase());
        if (!st) continue;
        if (!groups.has(st.id)) groups.set(st.id, { store: st, skus: [] });
        groups.get(st.id)!.skus.push(sku);
      }
      const finalByKey = new Map(plan.map((c, i) => [c.key, finalNames[i]]));
      const jobs: Array<{ id: string; fileName: string; campaigns: number; store: string }> = [];
      for (const { store, skus } of groups.values()) {
        const formG = { ...form, selectedSkus: skus };
        const filesG = generateAllFiles(formG, infos, keywordParts, asins);
        const planG = planCampaigns(formG, infos, keywordParts, asins.length);
        applyNameEdits(filesG, planG, nameEdits);
        const cleanStore = store.name.replace(/[^A-Za-z0-9._-]+/g, "_");
        // Mỗi store 1 file gộp (sheet SP + sheet SB) → 1 job upload
        if (filesG.length) {
          const f = combineGeneratedFiles(filesG, formG);
          const camps = planG.map((c) => ({ ...c, finalName: finalByKey.get(c.key) || c.name }));
          const buffer = await writeCombinedXlsx(f);
          const jobId = crypto.randomUUID();
          const fileName = `NewCamp_${cleanStore}_${f.fileName.replace(/[^A-Za-z0-9._ -]+/g, "_")}`;
          const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
          const r2Key = `${r2KeyPrefix()}/ppc-bulk-upload/${cleanStore}/${jobId}/${fileName}`;
          await putStoredObject({
            key: r2Key,
            bytes: buffer,
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            sha256,
            metadata: { purpose: "amazon-ads-bulk-upload", store: cleanStore, job: jobId },
          });
          const actionsPayload = camps.map((c, i) => ({
            id: `newcamp-${jobId.slice(0, 8)}-${i}`,
            sku: c.sku,
            campaignName: c.finalName,
            adType: c.label,
            actionType: "CREATE_CAMPAIGN",
            status: "PENDING",
          }));
          await sql`
            INSERT INTO ppc_auto_upload_logs (
              id, team_id, store_id, file_name, action_count, skus, status, stage,
              file_status, progress_pct, action_ids, actions_payload, r2_key, sha256, updated_at, created_by
            ) VALUES (
              ${jobId}, ${actor.teamId}, ${store.id}, ${fileName}, ${camps.length},
              ${sql.json([...new Set(camps.map((c) => c.sku))])}, 'PENDING', 'FILE_READY',
              'SUCCESS', 25, ${sql.json([])}, ${sql.json(actionsPayload)}, ${r2Key}, ${sha256}, NOW(), ${actor.userId}
            )
          `;
          jobs.push({ id: jobId, fileName, campaigns: camps.length, store: store.name });
        }
        rememberUploadedCampaigns(actor.teamId, store.name, planG.map((c) => finalByKey.get(c.key) || c.name));
      }
      return withUploadHeaders(Response.json({ success: true, stores: [...groups.values()].map((g) => g.store.name), jobs }, { status: 202 }));
    }

    // Gộp cả lượt thành 1 file bulk (sheet SP + sheet SB); output=zip (từng file riêng) vẫn giữ để tương thích
    if (str(formData.get("output")) !== "zip") {
      const combined = combineGeneratedFiles(files, form);
      const out = [{ name: combined.fileName, rows: combined.rowCount, data: (await writeCombinedXlsx(combined)).toString("base64") }];
      return withUploadHeaders(Response.json({ success: true, files: out }, { headers: { "Cache-Control": "no-store" } }));
    }

    const zip = await buildCampaignZip(files);
    const zipName = `Campaigns_${form.selectedSkus[0]}_${form.ngay}.zip`;
    return withUploadHeaders(new Response(new Uint8Array(zip), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${asciiFileName(zipName)}"; filename*=UTF-8''${encodeURIComponent(zipName)}`,
        "Cache-Control": "no-store",
        "X-Generated-Files": encodeURIComponent(files.map((f) => `${f.fileName}:${f.rows.length}`).join("|")),
      },
    }));
  } catch (error) {
    const wrapped = error instanceof NewCampInputError ? new ApiError(error.message, 400) : error;
    return withUploadHeaders(routeErrorResponse(wrapped, "Lỗi khi tạo file lên camp.", 500));
  }
}
