"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, safeJson } from "./dashboard/components";

const localStorageTokenKey = "gtmbench-token";
const localStorageInviteKey = "gtmbench-invite-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-[#f9f9fb]"><div className="h-5 w-5 animate-spin rounded-full border-2 border-[#e6e6e9] border-t-[#6b6f76]" /></main>}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Invite token from URL or localStorage
  const inviteToken = useMemo(() => {
    const fromUrl = searchParams.get("invite");
    if (fromUrl) {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(localStorageInviteKey, fromUrl);
      }
      return fromUrl;
    }
    if (typeof window !== "undefined") {
      return window.localStorage.getItem(localStorageInviteKey);
    }
    return null;
  }, [searchParams]);

  const [inviteWorkspace, setInviteWorkspace] = useState<{ name: string } | null>(null);

  useEffect(() => {
    const token = window.localStorage.getItem(localStorageTokenKey);
    if (token) {
      router.replace(inviteToken ? `/onboarding?invite=${inviteToken}` : "/dashboard");
      return;
    }

    // If we have an invite token, fetch workspace info for display
    if (inviteToken) {
      void apiFetch(`${apiBaseUrl}/invite/${inviteToken}`)
        .then(async (res) => {
          if (res.ok) {
            const data = (await safeJson(res)) as { workspace?: { name: string } };
            if (data.workspace) setInviteWorkspace(data.workspace);
          }
        })
        .catch(() => { /* ignore */ });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSignInWithGoogle() {
    setLoading(true);
    setError(null);
    try {
      const pendingInvite = inviteToken ?? window.localStorage.getItem(localStorageInviteKey);
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
    <main className="flex min-h-screen items-center justify-center bg-[#f9f9fb] px-4 py-10">
      {/* Card */}
      <div className="flex w-full max-w-[380px] flex-col overflow-hidden rounded-2xl border border-[#e6e6e9] bg-white shadow-sm">

        {/* Top — GIF with logo overlay */}
        <div className="relative" style={{ height: 320 }}>
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
            className="absolute left-4 top-4 h-14 w-14 object-contain"
          />
        </div>

        {/* Bottom — white CTA area */}
        <div className="flex flex-col items-center px-6 pt-5 pb-6">
          {inviteWorkspace ? (
            <>
              <h2 className="mb-1 text-[15px] font-semibold text-[#1b1b1f]">
                Join {inviteWorkspace.name}
              </h2>
              <p className="mb-5 text-[13px] text-[#8b8d94]">
                Sign in with Google to accept the invitation.
              </p>
            </>
          ) : (
            <>
              <h2 className="mb-1 text-[15px] font-semibold text-[#1b1b1f]">Welcome to sidr</h2>
              <p className="mb-5 text-[13px] text-[#8b8d94]">Sign in to continue to your workspace.</p>
            </>
          )}

          {error && <p className="mb-3 text-[12px] text-red-500">{error}</p>}

          <button
            onClick={() => void handleSignInWithGoogle()}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2.5 rounded-md border border-[#e6e6e9] bg-white px-4 py-2 text-[13px] font-medium text-[#1b1b1f] transition-colors hover:bg-[#f5f5f7] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#e6e6e9] border-t-[#6b6f76]" />
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
