"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

interface Member {
  _id: string;
  email: string;
  fullName?: string | null;
  profilePhotoUrl?: string | null;
  role: string;
}

interface Invite {
  _id: string;
  token: string;
  createdAt: string;
  expiresAt: string;
}

export default function WorkspaceSettingsPage() {
  const router = useRouter();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const [authToken, setAuthToken] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteCreating, setInviteCreating] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
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

    void Promise.all([
      apiFetch(`${apiBaseUrl}/workspace`, { headers: { Authorization: `Bearer ${token}` } }),
      apiFetch(`${apiBaseUrl}/workspace/members`, { headers: { Authorization: `Bearer ${token}` } }),
      apiFetch(`${apiBaseUrl}/workspace/invites`, { headers: { Authorization: `Bearer ${token}` } }),
    ]).then(async ([wsRes, membersRes, invitesRes]) => {
      const wsData = (await wsRes.json()) as { workspace: WorkspaceData | null };
      const membersData = (await membersRes.json()) as { members: Member[] };
      const invitesData = (await invitesRes.json()) as { invites: Invite[] };
      if (wsData.workspace) {
        setWorkspace(wsData.workspace);
        setName(wsData.workspace.name ?? "");
        setLogoUrl(wsData.workspace.logoUrl ?? "");
        setWebsiteUrl(wsData.workspace.websiteUrl ?? "");
        setDescription(wsData.workspace.description ?? "");
      }
      setMembers(membersData.members ?? []);
      setInvites(invitesData.invites ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
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

  const createInvite = useCallback(async () => {
    setInviteCreating(true);
    try {
      const res = await apiFetch(`${apiBaseUrl}/workspace/invite`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) throw new Error(data.error ?? "Failed");
      const link = `${window.location.origin}/onboarding?invite=${data.token}`;
      setInviteLink(link);
      setInvites((prev) => [
        { _id: data.token!, token: data.token!, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() },
        ...prev,
      ]);
    } catch { /* ignore */ } finally {
      setInviteCreating(false);
    }
  }, [apiBaseUrl, authToken]);

  async function revokeInvite(token: string) {
    await apiFetch(`${apiBaseUrl}/workspace/invites/${token}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    setInvites((prev) => prev.filter((i) => i.token !== token));
    if (inviteLink?.includes(token)) setInviteLink(null);
  }

  function copyLink(link: string, token: string) {
    void navigator.clipboard.writeText(link);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
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
          <h1 className="text-lg font-semibold text-[#1b1b1f]">Workspace</h1>
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
    <div className="mx-auto max-w-xl px-6 py-8 space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-[#1b1b1f]">Workspace</h1>
        <p className="text-[13px] text-[#6b6f76]">Manage your company workspace settings.</p>
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

      {/* Invite Members */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-[#1b1b1f]">Invite Members</h2>
          <button
            onClick={() => void createInvite()}
            disabled={inviteCreating}
            className="rounded-md bg-[#1b1b1f] px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {inviteCreating ? "Generating..." : "Generate invite link"}
          </button>
        </div>

        {/* Newly created invite link */}
        {inviteLink && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-[#e6e6e9] bg-[#f9f9fb] p-3">
            <input
              readOnly
              value={inviteLink}
              className="flex-1 bg-transparent text-[12px] text-[#6b6f76] outline-none truncate"
            />
            <button
              onClick={() => copyLink(inviteLink, inviteLink.split("invite=")[1] ?? "")}
              className="shrink-0 rounded-md border border-[#e6e6e9] bg-white px-2.5 py-1 text-[11px] font-medium text-[#6b6f76] hover:bg-[#ededf0]"
            >
              {copiedToken ? "Copied!" : "Copy"}
            </button>
          </div>
        )}

        {/* Pending invites */}
        {invites.length > 0 && (
          <div className="rounded-lg border border-[#e6e6e9] divide-y divide-[#ededf0]">
            {invites.map((inv) => {
              const link = `${typeof window !== "undefined" ? window.location.origin : ""}/onboarding?invite=${inv.token}`;
              const isCopied = copiedToken === inv.token;
              return (
                <div key={inv._id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-[#6b6f76] truncate font-mono">{inv.token.slice(0, 8)}…</p>
                    <p className="text-[11px] text-[#8b8d94]">
                      Expires {new Date(inv.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => copyLink(link, inv.token)}
                    className="shrink-0 rounded-md border border-[#e6e6e9] px-2.5 py-1 text-[11px] font-medium text-[#6b6f76] hover:bg-[#f5f5f7]"
                  >
                    {isCopied ? "Copied!" : "Copy link"}
                  </button>
                  <button
                    onClick={() => void revokeInvite(inv.token)}
                    className="shrink-0 text-[11px] text-red-400 hover:text-red-600"
                  >
                    Revoke
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {invites.length === 0 && (
          <p className="text-[12px] text-[#8b8d94]">No pending invites. Generate a link to invite teammates.</p>
        )}
      </div>

      {/* Members */}
      {members.length > 0 && (
        <div>
          <h2 className="text-[14px] font-semibold text-[#1b1b1f] mb-3">
            Members <span className="ml-1 text-[12px] font-normal text-[#8b8d94]">{members.length}</span>
          </h2>
          <div className="rounded-lg border border-[#e6e6e9] divide-y divide-[#ededf0]">
            {members.map((m) => {
              const displayName = m.fullName ?? m.email;
              const initial = displayName.charAt(0).toUpperCase();
              return (
                <div key={m._id} className="flex items-center gap-3 px-4 py-3">
                  <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-[#f5f5f7]">
                    {m.profilePhotoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.profilePhotoUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-[#6b6f76]">{initial}</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-[#1b1b1f] truncate">{displayName}</p>
                    {m.fullName && <p className="text-[11px] text-[#8b8d94] truncate">{m.email}</p>}
                  </div>
                  <span className="text-[11px] font-medium rounded-md bg-[#f5f5f7] px-2 py-0.5 text-[#6b6f76] capitalize">
                    {m.role}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
