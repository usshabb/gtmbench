"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../components";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

interface WorkspaceData {
  _id: string;
  name: string;
  domain: string;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  description?: string | null;
}

export default function WorkspaceSettingsPage() {
  const router = useRouter();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const [authToken, setAuthToken] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoUploadError, setLogoUploadError] = useState("");
  const logoInputRef = useRef<HTMLInputElement>(null);
  const checkedRef = useRef(false);

  useEffect(() => {
    const token = window.localStorage.getItem(localStorageTokenKey);
    if (!token) { router.replace("/"); return; }
    setAuthToken(token);
    if (checkedRef.current) return;
    checkedRef.current = true;

    void apiFetch(`${apiBaseUrl}/workspace`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = (await res.json()) as { workspace: WorkspaceData | null };
        if (data.workspace) {
          setWorkspace(data.workspace);
          setName(data.workspace.name ?? "");
          setLogoUrl(data.workspace.logoUrl ?? "");
          setWebsiteUrl(data.workspace.websiteUrl ?? "");
          setDescription(data.workspace.description ?? "");
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogoUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    setLogoUploadError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("fileName", file.name);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Upload failed");
      setLogoUrl(data.url);
    } catch (err) {
      setLogoUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLogoUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await apiFetch(`${apiBaseUrl}/workspace`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          name: name.trim(),
          logoUrl: logoUrl.trim() || null,
          websiteUrl: websiteUrl.trim() || null,
          description: description.trim() || null,
        }),
      });
      const data = (await res.json()) as { workspace?: WorkspaceData; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      if (data.workspace) setWorkspace(data.workspace);
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
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#d4d4d8] border-t-[#6b6f76]" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="mx-auto max-w-xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-[17px] font-semibold text-[#1b1b1f]">General</h1>
        </div>
        <div className="rounded-lg border border-[#e6e6e9] p-8 text-center">
          <p className="text-[14px] font-medium text-[#6b6f76]">No workspace set up</p>
          <p className="mt-1 text-[13px] text-[#8b8d94]">Complete onboarding to create a workspace.</p>
          <button
            onClick={() => router.push("/onboarding")}
            className="mt-4 rounded-md bg-[#1b1b1f] px-5 py-2 text-[13px] font-medium text-white hover:opacity-90"
          >
            Set up workspace
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-8 py-8 space-y-8">
      <div>
        <h1 className="text-[17px] font-semibold text-[#1b1b1f]">General</h1>
        <p className="mt-0.5 text-[13px] text-[#6b6f76]">Manage your company workspace settings.</p>
      </div>

      {/* Logo + name header */}
      <div className="flex items-center gap-4">
        <div className="relative h-14 w-14 shrink-0">
          <div className="h-14 w-14 overflow-hidden rounded-lg border border-[#e6e6e9] bg-[#f9f9fb] flex items-center justify-center">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-full w-full object-contain p-1" onError={() => setLogoUrl("")} />
            ) : (
              <span className="text-lg font-semibold text-[#8b8d94]">{name.charAt(0).toUpperCase()}</span>
            )}
          </div>
          {logoUploading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/30">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            </div>
          )}
        </div>
        <div>
          <p className="text-[15px] font-semibold text-[#1b1b1f]">{workspace.name}</p>
          <p className="text-[12px] text-[#8b8d94]">{workspace.domain}</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <div className="rounded-lg border border-[#e6e6e9] divide-y divide-[#ededf0]">
          <div className="p-4">
            <label className="block text-[13px] font-medium text-[#6b6f76] mb-1.5">Company name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-md border border-[#e6e6e9] px-3 py-2 text-[13px] placeholder:text-[#8b8d94] focus:border-[#5e6ad2] focus:ring-1 focus:ring-[#5e6ad2]/20 focus:outline-none"
            />
          </div>
          <div className="p-4">
            <label className="block text-[13px] font-medium text-[#6b6f76] mb-1.5">Logo</label>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-[#e6e6e9] bg-[#f9f9fb] flex items-center justify-center">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="" className="h-full w-full object-contain p-0.5" onError={() => setLogoUrl("")} />
                ) : (
                  <span className="text-xs font-semibold text-[#8b8d94]">{name.charAt(0).toUpperCase()}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={logoUploading}
                className="rounded-md border border-[#e6e6e9] px-3 py-1.5 text-[12px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7] disabled:opacity-60"
              >
                {logoUploading ? "Uploading..." : "Upload logo"}
              </button>
              {logoUrl && (
                <button
                  type="button"
                  onClick={() => setLogoUrl("")}
                  className="text-[12px] text-[#8b8d94] hover:text-red-500 transition-colors"
                >
                  Remove
                </button>
              )}
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleLogoUpload}
              />
            </div>
            {logoUploadError && <p className="mt-1 text-[11px] text-red-500">{logoUploadError}</p>}
          </div>
          <div className="p-4">
            <label className="block text-[13px] font-medium text-[#6b6f76] mb-1.5">Website URL</label>
            <input
              type="url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://acme.com"
              className="w-full rounded-md border border-[#e6e6e9] px-3 py-2 text-[13px] placeholder:text-[#8b8d94] focus:border-[#5e6ad2] focus:ring-1 focus:ring-[#5e6ad2]/20 focus:outline-none"
            />
          </div>
          <div className="p-4">
            <label className="block text-[13px] font-medium text-[#6b6f76] mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does your company do?"
              rows={3}
              className="w-full resize-none rounded-md border border-[#e6e6e9] px-3 py-2 text-[13px] placeholder:text-[#8b8d94] focus:border-[#5e6ad2] focus:ring-1 focus:ring-[#5e6ad2]/20 focus:outline-none"
            />
          </div>
          <div className="p-4">
            <label className="block text-[13px] font-medium text-[#6b6f76] mb-1">Domain</label>
            <p className="text-[13px] text-[#6b6f76]">{workspace.domain}</p>
            <p className="mt-0.5 text-[11px] text-[#8b8d94]">Domain cannot be changed.</p>
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
    </div>
  );
}
