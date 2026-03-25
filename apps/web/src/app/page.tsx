"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f7fafc] px-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#e8ecf4_0%,_transparent_50%)]" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-[500px] w-[800px] rounded-full bg-[#5469d4]/[0.04] blur-3xl" />

      <div className="relative w-full max-w-sm animate-fade-in">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1a1f36] shadow-lg shadow-[#1a1f36]/20">
            <span className="text-xl font-bold text-white tracking-tight">G</span>
          </div>
          <h1 className="text-2xl font-semibold text-[#1a1f36] tracking-tight">GTMbench</h1>
          <p className="mt-2 text-[14px] text-[#697386]">Your go-to-market command center</p>
        </div>

        <div className="rounded-2xl border border-[#e3e8ee] bg-white p-7 shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
          <button
            onClick={() => void handleSignInWithGoogle()}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-[#e3e8ee] bg-white px-4 py-3.5 text-[14px] font-medium text-[#1a1f36] transition-all hover:border-[#d9dce1] hover:bg-[#f7fafc] hover:shadow-sm active:scale-[0.99]"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
          <p className="mt-5 text-center text-[12px] leading-relaxed text-[#a3acb9]">
            We use Google to verify your identity and connect your Gmail and Calendar.
          </p>
        </div>

        <p className="mt-6 text-center text-[11px] text-[#c2c7cf]">
          Secure authentication powered by Google OAuth
        </p>
      </div>
    </main>
  );
}
