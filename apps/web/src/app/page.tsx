"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "./dashboard/components";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

export default function LoginPage() {
  const router = useRouter();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = window.localStorage.getItem(localStorageTokenKey);
    if (token) router.replace("/dashboard");
  }, [router]);

  async function handleSignInWithGoogle() {
    setLoading(true);
    setError(null);
    try {
      const pendingInvite = window.localStorage.getItem("gtmbench-invite-token");
      const params = new URLSearchParams();
      if (pendingInvite) params.set("inviteToken", pendingInvite);

      const res = await apiFetch(`${apiBaseUrl}/auth/google/signin-url?${params.toString()}`);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = (await res.json()) as { url: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No redirect URL returned");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f0eeea] px-4 py-10">
      {/* Card */}
      <div className="flex w-full max-w-[380px] flex-col overflow-hidden rounded-[24px] shadow-xl">

        {/* Top 70% — GIF with logo overlay */}
        <div className="relative" style={{ height: 340 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/bg.gif"
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* Logo top-left */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="sidr"
            className="absolute left-4 top-4 h-16 w-16 object-contain drop-shadow-md"
          />
        </div>

        {/* Bottom 30% — white CTA area */}
        <div className="flex flex-col items-center bg-white px-7 pt-6 pb-7">
          <h2 className="mb-1 text-[17px] font-semibold text-zinc-900">Welcome to sidr</h2>
          <p className="mb-5 text-[13px] text-zinc-400">Sign in to continue to your workspace.</p>

          {error && <p className="mb-3 text-[12px] text-red-500">{error}</p>}

          <button
            onClick={() => void handleSignInWithGoogle()}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-[13px] font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ borderRadius: 12 }}
          >
            {loading ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black/60" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
            )}
            Continue with Google
          </button>
        </div>

      </div>
    </main>
  );
}
