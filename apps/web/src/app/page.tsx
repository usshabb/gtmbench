"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

export default function LoginPage() {
  const router = useRouter();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  useEffect(() => {
    const token = window.localStorage.getItem(localStorageTokenKey);
    if (token) router.replace("/dashboard");
  }, [router]);

  async function handleSignInWithGoogle() {
    const pendingInvite = window.localStorage.getItem("gtmbench-invite-token");
    const params = new URLSearchParams();
    if (pendingInvite) params.set("inviteToken", pendingInvite);

    const res = await fetch(`${apiBaseUrl}/auth/google/signin-url?${params.toString()}`);
    const data = (await res.json()) as { url: string };
    if (data.url) window.location.href = data.url;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-900">
            <span className="text-lg font-bold text-white">G</span>
          </div>
          <h1 className="text-xl font-semibold text-zinc-900">GTMbench</h1>
          <p className="mt-1 text-[13px] text-zinc-500">Sign in to your account</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <button
            onClick={() => void handleSignInWithGoogle()}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-[14px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 active:bg-zinc-100"
          >
            {/* Google "G" logo */}
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
          <p className="mt-4 text-center text-[11px] text-zinc-400">
            We use Google to verify your identity and connect your Gmail and Calendar.
          </p>
        </div>
      </div>
    </main>
  );
}
