"use client";

import { CheckCircleIcon, LockKeyIcon, UserPlusIcon } from "@phosphor-icons/react";
import { useState } from "react";

type AuthMode = "login" | "register";

export function LoginScreen() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError("");
    setNotice("");
    setPassword("");
    setConfirmPassword("");
  };

  const canSubmit = mode === "login"
    ? username.trim().length >= 3 && password.length >= 10
    : displayName.trim().length >= 2 && username.trim().length >= 3 &&
      password.length >= 10 && confirmPassword.length >= 10;

  const submit = async () => {
    if (mode === "register" && password !== confirmPassword) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        mode === "login" ? "/api/auth/session" : "/api/auth/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "login"
              ? { username: username.trim().toLowerCase(), password }
              : {
                  displayName: displayName.trim(),
                  username: username.trim().toLowerCase(),
                  password,
                },
          ),
        },
      );
      const body = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(body.error || "Không thể hoàn tất yêu cầu.");
      if (mode === "login") {
        window.location.reload();
        return;
      }
      setNotice(body.message || "Đã gửi đăng ký. Vui lòng chờ admin duyệt.");
      setPassword("");
      setConfirmPassword("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Không thể hoàn tất yêu cầu.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#f3f5f7] p-5">
      <section className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-[#d8dde1] bg-white shadow-[0_24px_70px_rgba(31,41,49,0.14)]">
        <div className="border-b border-[#e2e6e9] px-6 pb-5 pt-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-white shadow-sm">
              <LockKeyIcon size={20} weight="fill" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-[#222b32]">Listing Desk</h1>
              <p className="mt-0.5 text-xs font-medium text-[#65717c]">Tài khoản riêng, dữ liệu team dùng chung</p>
            </div>
          </div>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#eef1f3] p-1" role="tablist" aria-label="Xác thực tài khoản">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              onClick={() => switchMode("login")}
              className={`rounded-lg px-3 py-2 text-xs font-bold transition ${mode === "login" ? "bg-white text-blue-700 shadow-sm" : "text-[#65717c] hover:text-[#39444d]"}`}
            >
              Đăng nhập
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "register"}
              onClick={() => switchMode("register")}
              className={`rounded-lg px-3 py-2 text-xs font-bold transition ${mode === "register" ? "bg-white text-blue-700 shadow-sm" : "text-[#65717c] hover:text-[#39444d]"}`}
            >
              Đăng ký
            </button>
          </div>

          <div className="mt-5 space-y-4">
            {mode === "register" ? (
              <div>
                <label className="block text-xs font-bold text-[#39444d]" htmlFor="display-name">Tên hiển thị</label>
                <input
                  id="display-name"
                  autoComplete="name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="field-control mt-2"
                  placeholder="Tên dùng trong team"
                  maxLength={80}
                />
              </div>
            ) : null}

            <div>
              <label className="block text-xs font-bold text-[#39444d]" htmlFor="username">Tên đăng nhập</label>
              <input
                id="username"
                autoCapitalize="none"
                autoComplete="username"
                spellCheck={false}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="field-control mt-2"
                placeholder="Ví dụ: minh.nguyen"
                maxLength={32}
              />
              {mode === "register" ? <p className="mt-1.5 text-[11px] leading-4 text-[#65717c]">Dùng chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang.</p> : null}
            </div>

            <div>
              <label className="block text-xs font-bold text-[#39444d]" htmlFor="password">Mật khẩu</label>
              <input
                id="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && canSubmit) void submit(); }}
                className="field-control mt-2"
                minLength={10}
                maxLength={128}
              />
              {mode === "register" ? <p className="mt-1.5 text-[11px] leading-4 text-[#65717c]">Tối thiểu 10 ký tự.</p> : null}
            </div>

            {mode === "register" ? (
              <div>
                <label className="block text-xs font-bold text-[#39444d]" htmlFor="confirm-password">Nhập lại mật khẩu</label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter" && canSubmit) void submit(); }}
                  className="field-control mt-2"
                  minLength={10}
                  maxLength={128}
                />
              </div>
            ) : null}
          </div>

          {error ? <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold leading-5 text-red-700" role="alert">{error}</p> : null}
          {notice ? (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-emerald-800" role="status">
              <CheckCircleIcon className="mt-0.5 shrink-0" size={16} weight="fill" />
              <p className="text-xs font-semibold leading-5">{notice}</p>
            </div>
          ) : null}

          <button
            type="button"
            disabled={loading || !canSubmit}
            onClick={() => void submit()}
            className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-extrabold text-white shadow-sm transition hover:bg-blue-700 active:translate-y-px disabled:bg-[#c5c9cc]"
          >
            {mode === "register" ? <UserPlusIcon size={16} weight="bold" /> : <LockKeyIcon size={16} weight="bold" />}
            {loading ? "Đang xử lý..." : mode === "login" ? "Đăng nhập" : "Gửi đăng ký"}
          </button>

          {mode === "register" ? (
            <p className="mt-4 text-center text-[11px] leading-5 text-[#65717c]">Tài khoản chỉ đăng nhập được sau khi admin phê duyệt.</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
