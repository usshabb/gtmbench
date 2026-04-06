"use client";

import { ChangeEvent, FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, safeJson } from "../../components";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

export default function ProfileSettingsPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><div className="h-5 w-5 animate-spin rounded-full border-2 border-[#d4d4d8] border-t-[#6b6f76]" /></div>}>
      <ProfileSettingsInner />
    </Suspense>
  );
}

function ProfileSettingsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
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

  // Connection status
  const [gmailConnected, setGmailConnected] = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<"gmail" | "calendar" | null>(null);
  const [connecting, setConnecting] = useState<"gmail" | "calendar" | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchConnectionStatus = useCallback(
    async (token: string) => {
      try {
        const res = await apiFetch(`${apiBaseUrl}/gmail/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = (await safeJson(res)) as {
            gmailConnected?: boolean;
            calendarConnected?: boolean;
          };
          setGmailConnected(data.gmailConnected ?? false);
          setCalendarConnected(data.calendarConnected ?? false);
        }
      } catch {
        // ignore
      } finally {
        setConnectionsLoading(false);
      }
    },
    [apiBaseUrl],
  );

  useEffect(() => {
    const token = window.localStorage.getItem(localStorageTokenKey);
    if (!token) { router.replace("/"); return; }
    setAuthToken(token);
    if (checkedRef.current) return;
    checkedRef.current = true;

    void apiFetch(`${apiBaseUrl}/me`, { headers: { Authorization: `Bearer ${token}` } })
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

    void fetchConnectionStatus(token);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If redirected back from Google OAuth with ?gmail=connected, refresh status
  useEffect(() => {
    if (searchParams.get("gmail") === "connected" && authToken) {
      void fetchConnectionStatus(authToken);
      // Clean up URL
      const url = new URL(window.location.href);
      url.searchParams.delete("gmail");
      window.history.replaceState({}, "", url.toString());
    }
  }, [searchParams, authToken, fetchConnectionStatus]);

  async function handlePhotoUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("fileName", file.name);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Upload failed");
      setProfilePhotoUrl(data.url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await apiFetch(`${apiBaseUrl}/me`, {
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

  async function handleConnect(service: "gmail" | "calendar") {
    setConnecting(service);
    try {
      // First try to re-enable if token already has scopes
      const reconnRes = await apiFetch(`${apiBaseUrl}/${service}/connect`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const reconnData = (await safeJson(reconnRes)) as { ok?: boolean; needsOAuth?: boolean };
      if (reconnData.ok) {
        if (service === "gmail") setGmailConnected(true);
        else setCalendarConnected(true);
        setConnecting(null);
        return;
      }

      // Need OAuth — redirect to Google
      const res = await apiFetch(
        `${apiBaseUrl}/auth/google/url?returnPath=/dashboard/settings/profile`,
        { headers: { Authorization: `Bearer ${authToken}` } },
      );
      const data = (await safeJson(res)) as { url?: string };
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setConnecting(null);
    }
  }

  async function handleDisconnect(service: "gmail" | "calendar") {
    setDisconnecting(service);
    try {
      await apiFetch(`${apiBaseUrl}/${service}/disconnect`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (service === "gmail") setGmailConnected(false);
      else setCalendarConnected(false);
    } catch {
      // ignore
    } finally {
      setDisconnecting(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#d4d4d8] border-t-[#6b6f76]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-[#1b1b1f]">Profile</h1>
        <p className="text-[13px] text-[#6b6f76]">Manage your personal information.</p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Avatar */}
        <div className="flex items-center gap-5">
          <div className="relative h-20 w-20 shrink-0">
            <div className="h-20 w-20 overflow-hidden rounded-full bg-[#f5f5f7]">
              {profilePhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profilePhotoUrl} alt="Profile" className="h-full w-full object-cover" onError={() => setProfilePhotoUrl("")} />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-[#8b8d94]">
                  {(fullName || email).charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            {uploading && (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/30">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-[13px] font-medium text-[#6b6f76]">Profile photo</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="rounded-md border border-[#e6e6e9] px-3 py-1.5 text-[12px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7] disabled:opacity-60"
              >
                {uploading ? "Uploading..." : "Upload photo"}
              </button>
              {profilePhotoUrl && (
                <button
                  type="button"
                  onClick={() => setProfilePhotoUrl("")}
                  className="text-[12px] text-[#8b8d94] hover:text-red-500 transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
            {uploadError && <p className="text-[11px] text-red-500">{uploadError}</p>}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoUpload}
            />
          </div>
        </div>

        <div className="rounded-lg border border-[#e6e6e9] divide-y divide-[#ededf0]">
          <div className="p-4">
            <label className="block text-[13px] font-medium text-[#6b6f76] mb-1.5">Full name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Smith"
              className="w-full rounded-md border border-[#e6e6e9] px-3 py-2 text-[13px] placeholder:text-[#8b8d94] focus:border-[#5e6ad2] focus:ring-1 focus:ring-[#5e6ad2]/20 focus:outline-none"
            />
          </div>
          <div className="p-4">
            <label className="block text-[13px] font-medium text-[#6b6f76] mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              disabled
              className="w-full rounded-md border border-[#e6e6e9] bg-[#f9f9fb] px-3 py-2 text-[13px] text-[#8b8d94]"
            />
            <p className="mt-1 text-[11px] text-[#8b8d94]">Email cannot be changed.</p>
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="flex-1 pr-4">
              <p className="text-[13px] font-medium text-[#6b6f76]">Share Gmail &amp; Calendar with workspace</p>
              <p className="mt-0.5 text-[12px] text-[#8b8d94]">
                When enabled, your connected Gmail and Google Calendar are visible to all workspace members.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={shareWithWorkspace}
              onClick={() => setShareWithWorkspace((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                shareWithWorkspace ? "bg-[#1b1b1f]" : "bg-[#e6e6e9]"
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
            className="rounded-md bg-[#1b1b1f] px-5 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
          {saved && <span className="text-[12px] text-[#059669] font-medium">Saved!</span>}
        </div>
      </form>

      {/* Connected accounts */}
      <div className="mt-10">
        <h2 className="text-[15px] font-semibold text-[#1b1b1f]">Connected accounts</h2>
        <p className="mt-1 text-[13px] text-[#6b6f76]">
          Manage your Google integrations. Connect to enable inbox and calendar features.
        </p>

        <div className="mt-4 rounded-lg border border-[#e6e6e9] divide-y divide-[#ededf0]">
          {/* Gmail */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="https://img.icons8.com/color/48/gmail-new.png" alt="Gmail" className="h-7 w-7" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-[#6b6f76]">Gmail</p>
                <p className="text-[12px] text-[#8b8d94]">
                  {gmailConnected ? "Connected" : "Not connected"}
                </p>
              </div>
            </div>
            {connectionsLoading ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#e6e6e9] border-t-[#6b6f76]" />
            ) : gmailConnected ? (
              <button
                type="button"
                disabled={disconnecting === "gmail"}
                onClick={() => handleDisconnect("gmail")}
                className="rounded-md border border-[#e6e6e9] px-3 py-1.5 text-[12px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7] disabled:opacity-60"
              >
                {disconnecting === "gmail" ? "Disconnecting..." : "Disconnect"}
              </button>
            ) : (
              <button
                type="button"
                disabled={connecting === "gmail"}
                onClick={() => handleConnect("gmail")}
                className="rounded-md bg-[#1b1b1f] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {connecting === "gmail" ? "Connecting..." : "Connect"}
              </button>
            )}
          </div>

          {/* Calendar */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="https://img.icons8.com/color/48/google-calendar--v2.png" alt="Google Calendar" className="h-7 w-7" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-[#6b6f76]">Google Calendar</p>
                <p className="text-[12px] text-[#8b8d94]">
                  {calendarConnected ? "Connected" : "Not connected"}
                </p>
              </div>
            </div>
            {connectionsLoading ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#e6e6e9] border-t-[#6b6f76]" />
            ) : calendarConnected ? (
              <button
                type="button"
                disabled={disconnecting === "calendar"}
                onClick={() => handleDisconnect("calendar")}
                className="rounded-md border border-[#e6e6e9] px-3 py-1.5 text-[12px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7] disabled:opacity-60"
              >
                {disconnecting === "calendar" ? "Disconnecting..." : "Disconnect"}
              </button>
            ) : (
              <button
                type="button"
                disabled={connecting === "calendar"}
                onClick={() => handleConnect("calendar")}
                className="rounded-md bg-[#1b1b1f] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {connecting === "calendar" ? "Connecting..." : "Connect"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
