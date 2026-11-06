"""
Đọc Google Sheet bằng service account (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY trong .env),
cùng tài khoản bot với lib/google/sheets.ts. Sheet phải được chia sẻ quyền Người xem cho email bot.
Cần thư viện `cryptography` (ký JWT RS256) — chạy trên máy dev, không dùng trong worker server.
"""
import base64
import json
import os
import re
import time
import urllib.parse
import urllib.request

SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"
_token = None


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _access_token() -> str:
    global _token
    if _token and _token[1] > time.time() + 60:
        return _token[0]
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    email = (os.environ.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") or "").strip()
    key_pem = (os.environ.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY") or "").replace("\\n", "\n")
    if not email or not key_pem:
        raise RuntimeError("Thiếu GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY")
    now = int(time.time())
    unsigned = (
        _b64url(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
        + "."
        + _b64url(json.dumps({"iss": email, "scope": SCOPE, "aud": "https://oauth2.googleapis.com/token",
                              "iat": now, "exp": now + 3600}).encode())
    )
    key = serialization.load_pem_private_key(key_pem.encode(), password=None)
    signature = key.sign(unsigned.encode(), padding.PKCS1v15(), hashes.SHA256())
    body = urllib.parse.urlencode({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": unsigned + "." + _b64url(signature),
    }).encode()
    with urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/token", data=body)) as res:
        data = json.loads(res.read())
    _token = (data["access_token"], time.time() + data.get("expires_in", 3600))
    return _token[0]


def _get(path: str):
    req = urllib.request.Request(
        f"https://sheets.googleapis.com/v4/spreadsheets/{path}",
        headers={"Authorization": f"Bearer {_access_token()}"},
    )
    with urllib.request.urlopen(req, timeout=300) as res:
        return json.loads(res.read())


def parse_spreadsheet_id(url_or_id: str) -> str:
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", url_or_id)
    return m.group(1) if m else url_or_id.strip()


def sheet_titles(spreadsheet_id: str) -> dict:
    """{sheetId(gid): title}"""
    meta = _get(f"{spreadsheet_id}?fields=sheets.properties(title,sheetId)")
    return {s["properties"]["sheetId"]: s["properties"]["title"] for s in meta["sheets"]}


def read_ranges(spreadsheet_id: str, ranges: list, render: str = "UNFORMATTED_VALUE") -> list:
    """Đọc nhiều vùng một lần; trả về list các bảng (list hàng) theo thứ tự ranges."""
    query = "&".join("ranges=" + urllib.parse.quote(r) for r in ranges)
    data = _get(f"{spreadsheet_id}/values:batchGet?valueRenderOption={render}&{query}")
    return [vr.get("values", []) for vr in data["valueRanges"]]


def read_columns(spreadsheet_id: str, tab: str, letters: list) -> list:
    """Đọc các cột (theo chữ cái) của 1 tab, ghép thành hàng: [[giá trị cột 1, cột 2, ...], ...]."""
    quoted = "'" + tab.replace("'", "''") + "'"
    cols = read_ranges(spreadsheet_id, [f"{quoted}!{c}:{c}" for c in letters])
    flat = [[row[0] if row else None for row in col] for col in cols]
    height = max((len(c) for c in flat), default=0)
    return [[c[i] if i < len(c) else None for c in flat] for i in range(height)]
