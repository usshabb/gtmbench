"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const localStorageTokenKey = "gtmbench-token";
const localStorageInviteKey = "gtmbench-invite-token";

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <AuthCallbackInner />
    </Suspense>
  );
}

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get("token");
    const onboardingComplete = searchParams.get("onboardingComplete") === "true";
    const inviteFromUrl = searchParams.get("invite");
    const error = searchParams.get("error");

    if (error || !token) {
      router.replace("/?error=signin_failed");
      return;
    }

    window.localStorage.setItem(localStorageTokenKey, token);

    // Preserve invite token in localStorage if it came through OAuth state
    if (inviteFromUrl) {
      window.localStorage.setItem(localStorageInviteKey, inviteFromUrl);
    }

    if (onboardingComplete) {
      window.localStorage.removeItem(localStorageInviteKey);
      router.replace("/dashboard");
    } else {
      const pendingInvite = inviteFromUrl ?? window.localStorage.getItem(localStorageInviteKey);
      router.replace(pendingInvite ? `/onboarding?invite=${pendingInvite}` : "/onboarding");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50">
      <div className="flex flex-col items-center gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700" />
        <p className="text-[13px] text-zinc-500">Signing you in…</p>
      </div>
    </main>
  );
}
