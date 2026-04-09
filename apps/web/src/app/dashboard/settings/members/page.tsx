"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, FallbackImg } from "../../components";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
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

export default function MembersSettingsPage() {
  const router = useRouter();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const [authToken, setAuthToken] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteCreating, setInviteCreating] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const checkedRef = useRef(false);

  useEffect(() => {
    const token = window.localStorage.getItem(localStorageTokenKey);
    if (!token) { router.replace("/"); return; }
    setAuthToken(token);
    if (checkedRef.current) return;
    checkedRef.current = true;

    void Promise.all([
      apiFetch(`${apiBaseUrl}/workspace/members`, { headers: { Authorization: `Bearer ${token}` } }),
      apiFetch(`${apiBaseUrl}/workspace/invites`, { headers: { Authorization: `Bearer ${token}` } }),
    ]).then(async ([membersRes, invitesRes]) => {
      const membersData = (await membersRes.json()) as { members: Member[] };
      const invitesData = (await invitesRes.json()) as { invites: Invite[] };
      setMembers(membersData.members ?? []);
      setInvites(invitesData.invites ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <div className="mx-auto max-w-xl px-8 py-8 space-y-8">
      <div>
        <h1 className="text-[17px] font-semibold text-[#1b1b1f]">Members</h1>
        <p className="mt-0.5 text-[13px] text-[#6b6f76]">Manage team members and invitations.</p>
      </div>

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

      {/* Members list */}
      {members.length > 0 && (
        <div>
          <h2 className="text-[14px] font-semibold text-[#1b1b1f] mb-3">
            Team <span className="ml-1 text-[12px] font-normal text-[#8b8d94]">{members.length}</span>
          </h2>
          <div className="rounded-lg border border-[#e6e6e9] divide-y divide-[#ededf0]">
            {members.map((m) => {
              const displayName = m.fullName ?? m.email;
              const initial = displayName.charAt(0).toUpperCase();
              return (
                <div key={m._id} className="flex items-center gap-3 px-4 py-3">
                  <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-[#f5f5f7]">
                    <FallbackImg src={m.profilePhotoUrl} className="h-full w-full object-cover">
                      <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-[#6b6f76]">{initial}</div>
                    </FallbackImg>
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
