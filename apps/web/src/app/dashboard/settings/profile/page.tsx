"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

export default function ProfileSettingsPage() {
  const router = useRouter();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const [authToken, setAuthToken] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [profilePhotoUrl, setProfilePhotoUrl] = useState("");
  const [shareWithWorkspace, setShareWithWorkspace] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const checkedRef = useRef(false);

  useEffect(() => {
    const token = window.localStorage.getItem(localStorageTokenKey);
    if (!token) { router.replace("/"); return; }
    setAuthToken(token);
    if (checkedRef.current) return;
    checkedRef.current = true;

    void fetch(`${apiBaseUrl}/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok) { router.replace("/"); return; }
        const data = (await res.json()) as {
          email: string;
          user?: { fullName?: string; profilePhotoUrl?: string; shareWithWorkspace?: boolean };
        };
        setEmail(data.email);
        setFullName(data.user?.fullName ?? "");
        setProfilePhotoUrl(data.user?.profilePhotoUrl ?? "");
        setShareWithWorkspace(data.user?.shareWithWorkspace !== false);
        setLoading(false);
      })
      .catch(() => router.replace("/"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch(`${apiBaseUrl}/me`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ fullName: fullName.trim(), profilePhotoUrl: profilePhotoUrl.trim() || null, shareWithWorkspace }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-zinc-900">Profile</h1>
        <p className="text-[13px] text-zinc-500">Manage your personal information.</p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Avatar */}
        <div className="flex items-center gap-5">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-zinc-100">
            {profilePhotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profilePhotoUrl} alt="Profile" className="h-full w-full object-cover" onError={() => setProfilePhotoUrl("")} />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-zinc-400">
                {(fullName || email).charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex-1">
            <label className="block text-[13px] font-medium text-zinc-700 mb-1.5">Profile photo URL</label>
            <input
              type="url"
              value={profilePhotoUrl}
              onChange={(e) => setProfilePhotoUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-[13px] placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
            />
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 divide-y divide-zinc-100">
          <div className="p-4">
            <label className="block text-[13px] font-medium text-zinc-700 mb-1.5">Full name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Smith"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-[13px] placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
            />
          </div>
          <div className="p-4">
            <label className="block text-[13px] font-medium text-zinc-700 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              disabled
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[13px] text-zinc-400"
            />
            <p className="mt-1 text-[11px] text-zinc-400">Email cannot be changed.</p>
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="flex-1 pr-4">
              <p className="text-[13px] font-medium text-zinc-700">Share Gmail &amp; Calendar with workspace</p>
              <p className="mt-0.5 text-[12px] text-zinc-400">
                When enabled, your connected Gmail and Google Calendar are visible to all workspace members.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={shareWithWorkspace}
              onClick={() => setShareWithWorkspace((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                shareWithWorkspace ? "bg-zinc-900" : "bg-zinc-200"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  shareWithWorkspace ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>

        {error && <p className="text-[12px] text-red-500">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-zinc-900 px-5 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
          {saved && <span className="text-[12px] text-green-600 font-medium">Saved!</span>}
        </div>
      </form>
    </div>
  );
}
