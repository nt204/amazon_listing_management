"use client";

import { useState } from "react";

export function LoginScreen() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const login = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Không thể đăng nhập.");
      window.location.reload();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Không thể đăng nhập.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#f6f7f8] p-5">
      <section className="w-full max-w-md rounded-xl border border-[#d8dde1] bg-white p-6 shadow-[0_20px_60px_rgba(31,41,49,0.12)]">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#a24419]">Listing Desk</p>
        <h1 className="mt-2 text-2xl font-bold text-[#222b32]">Team access</h1>
        <p className="mt-2 text-sm leading-6 text-[#65717c]">Nhập access token do quản trị viên workspace cấp.</p>
        <label className="mt-5 block text-xs font-bold text-[#39444d]" htmlFor="team-token">Access token</label>
        <input
          id="team-token"
          type="password"
          autoComplete="current-password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && token.length >= 24) void login(); }}
          className="field-control mt-2"
        />
        {error ? <p className="mt-3 text-sm text-[#b32921]" role="alert">{error}</p> : null}
        <button
          type="button"
          disabled={loading || token.length < 24}
          onClick={() => void login()}
          className="mt-5 h-10 w-full rounded-lg bg-[#b84f1d] px-4 text-sm font-bold text-white disabled:bg-[#c5c9cc]"
        >
          {loading ? "Đang xác thực..." : "Vào workspace"}
        </button>
      </section>
    </main>
  );
}
