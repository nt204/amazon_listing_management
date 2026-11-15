// Mục "Tài chính & dòng tiền" của Báo cáo tuần — dùng chung server + giao diện (không import server-only).
// Các dòng như sheet BÁO CÁO TUẦN TỔNG HỢP (mục VI):
//   Payment (USD)                      ← hệ thống (payout Done trong tuần)
//   Chi mua hàng (USD + quy đổi VND)   ← kế toán nhập
//   Dòng tiền kinh doanh ròng          = Payment − Chi mua hàng
//   CPVH chung, CPVH Tiktok/khác (VND) ← kế toán nhập;  TỔNG CPVH = cộng 2 dòng
//   Topup vốn trong tuần (VND)         ← kế toán nhập
//   Số dư quỹ đầu tuần                 = cuối tuần trước (tuần đầu tiên / muốn đặt lại thì nhập)
//   Tổng thu trong tuần                = Topup vốn
//   Tổng chi trong tuần                ← kế toán nhập (gồm cả CPVH, mua hàng trả VND, chi khác)
//   Số dư quỹ cuối tuần                = đầu tuần + thu − chi

export const CASHFLOW_FIELDS = ["purchase", "cpvhCommon", "tiktok", "topup", "totalSpend", "openingBalance"] as const;

export type CashflowField = (typeof CASHFLOW_FIELDS)[number];
export type CashflowValues = Partial<Record<CashflowField, number>>;

export interface WeeklyCashflow {
  weekStart: string;
  values: CashflowValues;
  /** Số dư cuối của tuần trước (null = chưa có tuần nào trước) */
  carriedOpening: number | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

const n = (v: number | undefined) => v ?? 0;

export const cpvhOf = (v: CashflowValues) => n(v.cpvhCommon) + n(v.tiktok);
export const closingOf = (opening: number | null, v: CashflowValues) => (opening == null ? null : opening + n(v.topup) - n(v.totalSpend));

export function computeCashflow(cf: WeeklyCashflow, payment: number) {
  const v = cf.values;
  const opening = v.openingBalance ?? cf.carriedOpening;
  return {
    payment,
    purchase: n(v.purchase),
    net: payment - n(v.purchase),
    cpvh: cpvhOf(v),
    opening,
    income: n(v.topup),
    spend: n(v.totalSpend),
    closing: closingOf(opening, v),
  };
}
