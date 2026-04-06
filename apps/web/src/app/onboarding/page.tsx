"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "../dashboard/components";

const localStorageTokenKey = "gtmbench-token";
const localStorageInviteKey = "gtmbench-invite-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

interface WorkspaceData {
  name: string;
  domain: string;
  logoUrl: string;
  websiteUrl: string;
  description: string;
}

// ─── Image upload helper ───────────────────────────────────────────────────────
async function uploadToImageKit(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("fileName", file.name);
  const res = await fetch("/api/upload", { method: "POST", body: form });
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error ?? "Upload failed");
  return data.url;
}

// ─── Upload row component ──────────────────────────────────────────────────────
function ImageUploadRow({
  label,
  hint,
  previewUrl,
  onUrl,
}: {
  label: string;
  hint?: string;
  previewUrl: string;
  onUrl: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  async function handleFile(file: File) {
    setUploading(true);
    setUploadError("");
    try {
      const url = await uploadToImageKit(file);
      onUrl(url);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3 rounded-md border border-[#e6e6e9] px-3 py-2.5">
        {/* Preview / icon */}
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#f5f5f7]">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={label} className="h-full w-full object-cover" />
          ) : (
            <svg className="h-6 w-6 text-black/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 3h18M3 3v18M3 3l18 18" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h19.5M2.25 3v18M2.25 3l19.5 19.5M21.75 3v18M21.75 21H2.25" />
              <circle cx="8.25" cy="8.25" r="1.5" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5l5.25-5.25 4.5 4.5 3-3 4.5 4.5" />
            </svg>
          )}
        </div>

        {/* Text */}
        <div className="flex-1">
          <p className="text-[13px] font-medium text-[#1b1b1f]">{label}</p>
          {hint && <p className="text-[11px] text-[#8b8d94]">{hint}</p>}
        </div>

        {/* Upload button */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="shrink-0 rounded-md border border-[#e6e6e9] bg-white px-3 py-1.5 text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7] disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Upload"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
        />
      </div>
      {uploadError && <p className="text-[12px] text-red-500">{uploadError}</p>}
    </div>
  );
}

// ─── Field components ──────────────────────────────────────────────────────────
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-medium text-[#6b6f76]">{label}</label>
      {children}
    </div>
  );
}

const inputCls =
  "h-10 w-full rounded-md border border-[#e6e6e9] bg-white px-3 text-[13px] text-[#1b1b1f] placeholder:text-[#8b8d94] focus:border-[#5e6ad2] focus:ring-1 focus:ring-[#5e6ad2]/20 focus:outline-none";

const textareaCls =
  "w-full rounded-md border border-[#e6e6e9] bg-white px-3 py-2.5 text-[13px] text-[#1b1b1f] placeholder:text-[#8b8d94] focus:border-[#5e6ad2] focus:ring-1 focus:ring-[#5e6ad2]/20 focus:outline-none resize-none";

// ─── Page ──────────────────────────────────────────────────────────────────────
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

  // Step 1
  const [fullName, setFullName] = useState("");
  const [profilePhotoUrl, setProfilePhotoUrl] = useState("");

  // Step 2
  const [workspaceMode, setWorkspaceMode] = useState<"loading" | "join" | "create" | "invite">("loading");
  const [existingWorkspace, setExistingWorkspace] = useState<{ _id: string; name: string; domain: string; logoUrl?: string | null } | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceData>({ name: "", domain: "", logoUrl: "", websiteUrl: "", description: "" });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const checkedRef = useRef(false);

  useEffect(() => {
    const token = window.localStorage.getItem(localStorageTokenKey);
    if (!token) {
      // Preserve invite token in redirect so login page can show context
      router.replace(inviteToken ? `/?invite=${inviteToken}` : "/");
      return;
    }
    setAuthToken(token);
    if (checkedRef.current) return;
    checkedRef.current = true;

    void apiFetch(`${apiBaseUrl}/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok) {
          window.localStorage.removeItem(localStorageTokenKey);
          router.replace(inviteToken ? `/?invite=${inviteToken}` : "/");
          return;
        }
        const data = (await res.json()) as { email: string; onboardingComplete?: boolean; user?: { fullName?: string; profilePhotoUrl?: string } };
        if (data.onboardingComplete) {
          // Already onboarded — if there's an invite, accept it directly
          if (inviteToken) {
            try {
              const acceptRes = await apiFetch(`${apiBaseUrl}/workspace/accept-invite`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ inviteToken }),
              });
              if (acceptRes.ok) {
                window.localStorage.removeItem(localStorageInviteKey);
              }
            } catch { /* proceed to dashboard anyway */ }
          }
          router.replace("/dashboard");
          return;
        }
        setUserEmail(data.email);
        if (data.user?.fullName) setFullName(data.user.fullName);
        if (data.user?.profilePhotoUrl) setProfilePhotoUrl(data.user.profilePhotoUrl);
      })
      .catch(() => {
        window.localStorage.removeItem(localStorageTokenKey);
        router.replace(inviteToken ? `/?invite=${inviteToken}` : "/");
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lookupWorkspace = useCallback(async (token: string, email: string) => {
    if (inviteToken) {
      try {
        const res = await apiFetch(`${apiBaseUrl}/invite/${inviteToken}`);
        const data = (await res.json()) as { workspace?: { _id: string; name: string; domain: string; logoUrl?: string | null }; error?: string };
        if (res.ok && data.workspace) { setExistingWorkspace(data.workspace); setWorkspaceMode("invite"); return; }
      } catch { /* fall through */ }
    }
    const domain = email.split("@")[1] ?? "";
    const freeDomains = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com"];
    if (!domain || freeDomains.includes(domain)) { setWorkspace((w) => ({ ...w, domain })); setWorkspaceMode("create"); return; }
    try {
      const res = await apiFetch(`${apiBaseUrl}/workspace/lookup?domain=${encodeURIComponent(domain)}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = (await res.json()) as { workspace: { _id: string; name: string; domain: string; logoUrl?: string | null } | null };
      if (data.workspace) { setExistingWorkspace(data.workspace); setWorkspaceMode("join"); return; }
    } catch { /* fall through */ }
    setWorkspace((w) => ({ ...w, domain, websiteUrl: `https://${domain}` }));
    setWorkspaceMode("create");
  }, [apiBaseUrl, inviteToken]);

  function handleStep1Submit(e: FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) { setError("Full name is required"); return; }
    setError("");

    // If user has an invite token, skip step 2 entirely — just join the workspace
    if (inviteToken) {
      void handleComplete(undefined, true);
      return;
    }

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
      const res = await apiFetch(`${apiBaseUrl}/onboarding/complete`, {
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
    <main className="flex min-h-screen flex-col bg-white">
      {/* Top-left logo */}
      <div className="p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="sidr" className="h-12 w-12 object-contain" />
      </div>

      {/* Centered content */}
      <div className="flex flex-1 items-start justify-center px-4 pt-2 pb-10">
        <div className="w-full max-w-[460px]">
          {/* Step indicator */}
          <div className="mb-6 flex items-center gap-0">
            {stepLabels.map((label, i) => {
              const num = (i + 1) as 1 | 2;
              const isActive = step === num;
              const isDone = step > num;
              const isLast = i === stepLabels.length - 1;
              return (
                <div key={label} className="flex flex-1 items-center">
                  <button
                    type="button"
                    onClick={() => isDone && setStep(num)}
                    className={`flex flex-col items-center gap-1.5 ${isDone ? "cursor-pointer" : "cursor-default"}`}
                  >
                    <div
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-medium transition-all ${
                        isDone
                          ? "bg-[#1b1b1f] text-white"
                          : isActive
                          ? "border-2 border-[#1b1b1f] bg-white text-[#1b1b1f]"
                          : "border-2 border-[#d4d4d8] bg-white text-[#8b8d94]"
                      }`}
                    >
                      {isDone ? (
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      ) : (
                        num
                      )}
                    </div>
                    <span
                      className={`text-[11px] font-medium whitespace-nowrap ${
                        isActive ? "text-[#1b1b1f]" : isDone ? "text-[#6b6f76]" : "text-[#8b8d94]"
                      }`}
                    >
                      {label}
                    </span>
                  </button>
                  {!isLast && (
                    <div className={`mx-2 mb-5 h-[1.5px] flex-1 rounded-full transition-all ${isDone ? "bg-[#1b1b1f]" : "bg-[#e6e6e9]"}`} />
                  )}
                </div>
              );
            })}
          </div>

        {/* Card */}
        <div className="min-h-[520px] rounded-xl border border-[#e6e6e9] bg-white p-5 shadow-sm">

          {/* Step 1: Profile */}
          {step === 1 && (
            <form onSubmit={handleStep1Submit} className="flex flex-col gap-4">

              <ImageUploadRow
                label="Profile photo"
                hint="Recommended 500 × 500"
                previewUrl={profilePhotoUrl}
                onUrl={setProfilePhotoUrl}
              />

              <Field label="Full name">
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Jane Smith"
                  required
                  autoFocus
                  className={inputCls}
                />
              </Field>

              <Field label="Email">
                <input
                  type="email"
                  value={userEmail}
                  disabled
                  className={`${inputCls} opacity-40 cursor-not-allowed`}
                />
              </Field>

              {error && <p className="text-[12px] text-red-500">{error}</p>}

              <button
                type="submit"
                className="mt-1 h-9 w-full rounded-md bg-[#1b1b1f] text-[13px] font-medium text-white transition-colors hover:bg-[#2c2c33]"
              >
                Continue
              </button>
            </form>
          )}

          {/* Step 2: Workspace */}
          {step === 2 && (
            <div className="flex flex-col gap-4">

              {workspaceMode === "loading" && (
                <div className="flex justify-center py-10">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/20 border-t-black/60" />
                </div>
              )}

              {workspaceMode === "invite" && existingWorkspace && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3 rounded-md border border-[#bbf7d0] bg-[#ecfdf5] p-3">
                    {existingWorkspace.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={existingWorkspace.logoUrl} alt="" className="h-10 w-10 rounded-lg object-contain" />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#d1fae5] text-[12px] font-medium text-[#059669]">
                        {existingWorkspace.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-[13px] font-medium text-[#1b1b1f]">{existingWorkspace.name}</p>
                      <p className="text-[12px] text-[#6b6f76]">You&apos;ve been invited to join this workspace</p>
                    </div>
                  </div>
                  {error && <p className="text-[12px] text-red-500">{error}</p>}
                  <button
                    onClick={() => void handleComplete(undefined, true)}
                    disabled={isLoading}
                    className="h-9 w-full rounded-md bg-[#1b1b1f] text-[13px] font-medium text-white transition-colors hover:bg-[#2c2c33] disabled:opacity-50"
                  >
                    {isLoading ? "Joining…" : `Join ${existingWorkspace.name}`}
                  </button>
                </div>
              )}

              {workspaceMode === "join" && existingWorkspace && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3 rounded-md border border-[#e6e6e9] p-3">
                    {existingWorkspace.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={existingWorkspace.logoUrl} alt="" className="h-10 w-10 rounded-lg object-contain" />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#f5f5f7] text-[12px] font-medium text-[#8b8d94]">
                        {existingWorkspace.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-[13px] font-medium text-[#1b1b1f]">{existingWorkspace.name}</p>
                      <p className="text-[12px] text-[#8b8d94]">{existingWorkspace.domain}</p>
                    </div>
                  </div>
                  <p className="text-[12px] text-[#6b6f76]">A workspace already exists for your domain. Join it or create a new one.</p>
                  {error && <p className="text-[12px] text-red-500">{error}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => void handleComplete(existingWorkspace._id)}
                      disabled={isLoading}
                      className="h-9 flex-1 rounded-md bg-[#1b1b1f] text-[13px] font-medium text-white transition-colors hover:bg-[#2c2c33] disabled:opacity-50"
                    >
                      {isLoading ? "Joining…" : `Join ${existingWorkspace.name}`}
                    </button>
                    <button
                      onClick={() => { setWorkspaceMode("create"); setWorkspace((w) => ({ ...w, domain: existingWorkspace.domain })); }}
                      className="h-9 rounded-md border border-[#e6e6e9] px-3 text-[13px] font-medium text-[#6b6f76] hover:bg-[#f5f5f7]"
                    >
                      Create new
                    </button>
                  </div>
                </div>
              )}

              {workspaceMode === "create" && (
                <form onSubmit={(e) => { e.preventDefault(); void handleComplete(); }} className="flex flex-col gap-4">
                  <ImageUploadRow
                    label="Company logo"
                    hint="500 × 500"
                    previewUrl={workspace.logoUrl}
                    onUrl={(url) => setWorkspace((w) => ({ ...w, logoUrl: url }))}
                  />

                  <Field label="Company name">
                    <input
                      type="text"
                      value={workspace.name}
                      onChange={(e) => setWorkspace((w) => ({ ...w, name: e.target.value }))}
                      placeholder="Acme Inc."
                      required
                      autoFocus
                      className={inputCls}
                    />
                  </Field>

                  <Field label="Mission statement">
                    <textarea
                      value={workspace.description}
                      onChange={(e) => setWorkspace((w) => ({ ...w, description: e.target.value }))}
                      placeholder="Add your one sentence mission statement."
                      rows={3}
                      className={textareaCls}
                    />
                  </Field>

                  <Field label="Website">
                    <input
                      type="url"
                      value={workspace.websiteUrl}
                      onChange={(e) => setWorkspace((w) => ({ ...w, websiteUrl: e.target.value }))}
                      placeholder="www.acme.com"
                      className={inputCls}
                    />
                  </Field>

                  <Field label="Domain">
                    <input
                      type="text"
                      value={workspace.domain}
                      onChange={(e) => setWorkspace((w) => ({ ...w, domain: e.target.value }))}
                      placeholder="acme.com"
                      required
                      className={inputCls}
                    />
                  </Field>

                  {error && <p className="text-[12px] text-red-500">{error}</p>}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="h-9 rounded-md border border-[#e6e6e9] px-3 text-[13px] font-medium text-[#6b6f76] hover:bg-[#f5f5f7]"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="h-9 flex-1 rounded-md bg-[#1b1b1f] text-[13px] font-medium text-white transition-colors hover:bg-[#2c2c33] disabled:opacity-50"
                    >
                      {isLoading ? "Setting up…" : "Create workspace"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
        </div>
      </div>
    </main>
  );
}
