export const runtime = "nodejs";

export async function POST() {
  return Response.json(
    { error: "Hệ thống đã chuyển sang xác thực Email qua Cloudflare Zero Trust, không sử dụng mật khẩu." },
    { status: 410 },
  );
}
