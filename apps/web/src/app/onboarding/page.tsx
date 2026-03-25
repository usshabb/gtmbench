"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const localStorageTokenKey = "gtmbench-token";
const localStorageInviteKey = "gtmbench-invite-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

interface WorkspaceData {
  name: string;
  domain: string;
  logoUrl: string;
  websiteUrl: string;
  description: string;
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingInner />
    </Suspense>
  );
}

function OnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Prefer URL param; fall back to localStorage (survives login redirect)
  const inviteTokenFromUrl = searchParams.get("invite");
  const inviteToken = useMemo(() => {
    if (inviteTokenFromUrl) {
      window.localStorage.setItem(localStorageInviteKey, inviteTokenFromUrl);
      return inviteTokenFromUrl;
    }
    return window.localStorage.getItem(localStorageInviteKey);
  }, [inviteTokenFromUrl]);
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const [authToken, setAuthToken] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 – profile
  const [fullName, setFullName] = useState("");
  const [profilePhotoUrl, setProfilePhotoUrl] = useState("");

  // Step 2 – workspace
  const [workspaceMode, setWorkspaceMode] = useState<"loading" | "join" | "create" | "invite">("loading");
  const [existingWorkspace, setExistingWorkspace] = useState<{ _id: string; name: string; domain: string; logoUrl?: string | null } | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceData>({ name: "", domain: "", logoUrl: "", websiteUrl: "", description: "" });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const checkedRef = useRef(false);

  // Guard: must be logged in and not yet onboarded
  useEffect(() => {
    const token = window.localStorage.getItem(localStorageTokenKey);
    if (!token) {
      // Preserve invite token in localStorage before redirecting to login
      // (already stored by the inviteToken useMemo above if present in URL)
      router.replace("/");
      return;
    }
    setAuthToken(token);
    if (checkedRef.current) return;
    checkedRef.current = true;

    void fetch(`${apiBaseUrl}/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok) { router.replace("/"); return; }
        const data = (await res.json()) as { email: string; onboardingComplete?: boolean; user?: { fullName?: string; profilePhotoUrl?: string } };
        if (data.onboardingComplete) { router.replace("/dashboard"); return; }
        setUserEmail(data.email);
        if (data.user?.fullName) setFullName(data.user.fullName);
        if (data.user?.profilePhotoUrl) setProfilePhotoUrl(data.user.profilePhotoUrl);
      })
      .catch(() => router.replace("/"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lookupWorkspace = useCallback(async (token: string, email: string) => {
    // If there's an invite token, look it up first
    if (inviteToken) {
      try {
        const res = await fetch(`${apiBaseUrl}/invite/${inviteToken}`);
        const data = (await res.json()) as { workspace?: { _id: string; name: string; domain: string; logoUrl?: string | null }; error?: string };
        if (res.ok && data.workspace) {
          setExistingWorkspace(data.workspace);
          setWorkspaceMode("invite");
          return;
        }
      } catch { /* fall through */ }
    }

    const domain = email.split("@")[1] ?? "";
    const freeDomains = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com"];
    if (!domain || freeDomains.includes(domain)) {
      setWorkspace((w) => ({ ...w, domain }));
      setWorkspaceMode("create");
      return;
    }

    // Check if workspace already exists for this domain
    try {
      const res = await fetch(`${apiBaseUrl}/workspace/lookup?domain=${encodeURIComponent(domain)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as { workspace: { _id: string; name: string; domain: string; logoUrl?: string | null } | null };
      if (data.workspace) {
        setExistingWorkspace(data.workspace);
        setWorkspaceMode("join");
        return;
      }
    } catch { /* fall through */ }

    // No existing workspace — pre-fill domain and let user fill the rest
    setWorkspace((w) => ({ ...w, domain, websiteUrl: `https://${domain}` }));
    setWorkspaceMode("create");
  }, [apiBaseUrl, inviteToken]);

  function handleStep1Submit(e: FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) { setError("Full name is required"); return; }
    setError("");
    setStep(2);
    void lookupWorkspace(authToken, userEmail);
  }

  async function handleComplete(joinId?: string, useInviteToken?: boolean) {
    setIsLoading(true);
    setError("");
    try {
      const body: Record<string, string | undefined> = {
        fullName: fullName.trim(),
        profilePhotoUrl: profilePhotoUrl.trim() || undefined,
      };
      if (useInviteToken && inviteToken) {
        body.inviteToken = inviteToken;
      } else if (joinId) {
        body.joinExistingWorkspaceId = joinId;
      } else {
        body.workspaceName = workspace.name.trim();
        body.workspaceDomain = workspace.domain.trim();
        body.workspaceLogoUrl = workspace.logoUrl.trim() || undefined;
        body.workspaceWebsiteUrl = workspace.websiteUrl.trim() || undefined;
        body.workspaceDescription = workspace.description.trim() || undefined;
      }

      const res = await fetch(`${apiBaseUrl}/onboarding/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to complete onboarding");
      window.localStorage.removeItem(localStorageInviteKey);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  }

  const stepLabels = ["Your profile", "Your workspace"];

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-900">
            <span className="text-lg font-bold text-white">G</span>
          </div>
          <h1 className="text-xl font-semibold text-zinc-900">Set up your account</h1>
          <p className="mt-1 text-[13px] text-zinc-500">Just a few things to get you started</p>
        </div>

        {/* Step indicator */}
        <div className="mb-6 flex items-center justify-center gap-2">
          {stepLabels.map((label, i) => {
            const num = i + 1;
            const isActive = step === num;
            const isDone = step > num;
            return (
              <div key={label} className="flex items-center gap-2">
                {i > 0 && <div className={`h-px w-8 ${isDone ? "bg-zinc-900" : "bg-zinc-200"}`} />}
                <div className="flex items-center gap-1.5">
                  <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                    isDone ? "bg-zinc-900 text-white" : isActive ? "bg-zinc-900 text-white" : "bg-zinc-200 text-zinc-500"
                  }`}>
                    {isDone ? (
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : num}
                  </div>
                  <span className={`text-[12px] font-medium ${isActive ? "text-zinc-900" : "text-zinc-400"}`}>{label}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">

          {/* Step 1: Profile */}
          {step === 1 && (
            <form onSubmit={handleStep1Submit} className="space-y-5">
              <div>
                <h2 className="text-[15px] font-semibold text-zinc-900">Your profile</h2>
                <p className="mt-0.5 text-[12px] text-zinc-400">This is how teammates will see you.</p>
              </div>

              {/* Avatar preview */}
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-zinc-100">
                  {profilePhotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={profilePhotoUrl} alt="Profile" className="h-full w-full object-cover" onError={() => setProfilePhotoUrl("")} />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xl font-semibold text-zinc-400">
                      {fullName.charAt(0).toUpperCase() || userEmail.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <label className="block text-[12px] font-medium text-zinc-600 mb-1">Profile photo URL</label>
                  <input
                    type="url"
                    value={profilePhotoUrl}
                    onChange={(e) => setProfilePhotoUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-[13px] placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-zinc-700 mb-1.5">Full name <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Jane Smith"
                  required
                  autoFocus
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-[13px] placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-zinc-700 mb-1.5">Email</label>
                <input
                  type="email"
                  value={userEmail}
                  disabled
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-[13px] text-zinc-400"
                />
              </div>

              {error && <p className="text-[12px] text-red-500">{error}</p>}

              <button
                type="submit"
                className="w-full rounded-lg bg-zinc-900 py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
              >
                Continue
              </button>
            </form>
          )}

          {/* Step 2: Workspace */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-[15px] font-semibold text-zinc-900">Your workspace</h2>
                <p className="mt-0.5 text-[12px] text-zinc-400">GTMbench accounts are set up at the company level.</p>
              </div>

              {workspaceMode === "loading" && (
                <div className="flex justify-center py-8">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
                </div>
              )}

              {workspaceMode === "invite" && existingWorkspace && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    {existingWorkspace.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={existingWorkspace.logoUrl} alt="" className="h-10 w-10 rounded-lg object-contain" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-[13px] font-bold text-emerald-600">
                        {existingWorkspace.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-[14px] font-semibold text-zinc-900">{existingWorkspace.name}</p>
                      <p className="text-[12px] text-zinc-500">You&apos;ve been invited to join this workspace</p>
                    </div>
                  </div>
                  {error && <p className="text-[12px] text-red-500">{error}</p>}
                  <button
                    onClick={() => void handleComplete(undefined, true)}
                    disabled={isLoading}
                    className="w-full rounded-lg bg-zinc-900 py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {isLoading ? "Joining..." : `Join ${existingWorkspace.name}`}
                  </button>
                </div>
              )}

              {workspaceMode === "join" && existingWorkspace && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 rounded-xl border border-zinc-200 p-4">
                    {existingWorkspace.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={existingWorkspace.logoUrl} alt="" className="h-10 w-10 rounded-lg object-contain" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-[13px] font-bold text-zinc-500">
                        {existingWorkspace.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-[14px] font-semibold text-zinc-900">{existingWorkspace.name}</p>
                      <p className="text-[12px] text-zinc-400">{existingWorkspace.domain}</p>
                    </div>
                  </div>
                  <p className="text-[12px] text-zinc-500">
                    A workspace already exists for your domain. Join it or create a new one.
                  </p>
                  {error && <p className="text-[12px] text-red-500">{error}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => void handleComplete(existingWorkspace._id)}
                      disabled={isLoading}
                      className="flex-1 rounded-lg bg-zinc-900 py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {isLoading ? "Joining..." : `Join ${existingWorkspace.name}`}
                    </button>
                    <button
                      onClick={() => {
                        setWorkspaceMode("create");
                        setWorkspace((w) => ({ ...w, domain: existingWorkspace.domain }));
                      }}
                      className="rounded-lg border border-zinc-200 px-4 py-2.5 text-[13px] font-medium text-zinc-600 hover:bg-zinc-50"
                    >
                      Create new
                    </button>
                  </div>
                </div>
              )}

              {workspaceMode === "create" && (
                <form onSubmit={(e) => { e.preventDefault(); void handleComplete(); }} className="space-y-4">
                  {/* Logo preview + URL */}
                  <div className="flex items-center gap-4">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 flex items-center justify-center">
                      {workspace.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={workspace.logoUrl} alt="" className="h-full w-full object-contain p-1" onError={() => setWorkspace((w) => ({ ...w, logoUrl: "" }))} />
                      ) : (
                        <span className="text-[11px] font-bold text-zinc-300">LOGO</span>
                      )}
                    </div>
                    <div className="flex-1">
                      <label className="block text-[12px] font-medium text-zinc-600 mb-1">Logo URL</label>
                      <input
                        type="url"
                        value={workspace.logoUrl}
                        onChange={(e) => setWorkspace((w) => ({ ...w, logoUrl: e.target.value }))}
                        placeholder="https://..."
                        className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-[13px] placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[13px] font-medium text-zinc-700 mb-1.5">
                        Company name <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={workspace.name}
                        onChange={(e) => setWorkspace((w) => ({ ...w, name: e.target.value }))}
                        placeholder="Acme Inc."
                        required
                        autoFocus
                        className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-[13px] placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[13px] font-medium text-zinc-700 mb-1.5">
                        Domain <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={workspace.domain}
                        onChange={(e) => setWorkspace((w) => ({ ...w, domain: e.target.value }))}
                        placeholder="acme.com"
                        required
                        className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-[13px] placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[13px] font-medium text-zinc-700 mb-1.5">Website URL</label>
                    <input
                      type="url"
                      value={workspace.websiteUrl}
                      onChange={(e) => setWorkspace((w) => ({ ...w, websiteUrl: e.target.value }))}
                      placeholder="https://acme.com"
                      className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-[13px] placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[13px] font-medium text-zinc-700 mb-1.5">Description</label>
                    <textarea
                      value={workspace.description}
                      onChange={(e) => setWorkspace((w) => ({ ...w, description: e.target.value }))}
                      placeholder="What does your company do?"
                      rows={2}
                      className="w-full resize-none rounded-lg border border-zinc-200 px-3 py-2 text-[13px] placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
                    />
                  </div>

                  {error && <p className="text-[12px] text-red-500">{error}</p>}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="rounded-lg border border-zinc-200 px-4 py-2.5 text-[13px] font-medium text-zinc-600 hover:bg-zinc-50"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="flex-1 rounded-lg bg-zinc-900 py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {isLoading ? "Setting up..." : "Create workspace"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
