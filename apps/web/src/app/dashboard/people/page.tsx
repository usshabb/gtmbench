"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LetterAvatar, DATA_CHANGED_EVENT, safeJson, dispatchGlobalAction, dispatchDataChanged, apiFetch } from "../components";

interface PersonRecord {
  _id?: string;
  userEmails: string[];
  linkedinUrl: string;
  buyerProfileId?: string | null;
  createdAt: string;
  enrichedAt?: string;
  enrichmentStatus: "pending" | "completed" | "failed";
  enrichmentData?: Record<string, unknown>;
  enrichmentError?: string;
}

interface BuyerProfile {
  _id: string;
  name: string;
  isDefault?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getFiberData(person: PersonRecord): Record<string, any> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = person.enrichmentData as any;
    return raw?.output?.data?.[0] ?? null;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getFullName(data: Record<string, any> | null, linkedinUrl: string): string {
  if (data?.name) return data.name as string;
  const parts = [data?.first_name, data?.last_name].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return linkedinUrl.split("/in/")[1]?.replace(/\/$/, "") ?? "Unknown";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLocation(data: Record<string, any>): string | undefined {
  if (data.locality) return data.locality as string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loc = data.inferred_location as Record<string, any> | undefined;
  if (!loc) return undefined;
  const parts = [loc.city, loc.state_name, loc.country_name].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/* ------------------------------------------------------------------ */
/*  Change Buyer Profile Modal                                          */
/* ------------------------------------------------------------------ */

function ChangeBuyerProfileModal({
  entityName,
  currentProfileId,
  allProfiles,
  onClose,
  onConfirm,
}: {
  entityName: string;
  currentProfileId: string | null;
  allProfiles: BuyerProfile[];
  onClose: () => void;
  onConfirm: (profileId: string | null) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string | null>(currentProfileId);
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    setSaving(true);
    try {
      await onConfirm(selected);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[500] flex items-start justify-center bg-black/30 p-4 pt-[18vh] backdrop-blur-[2px]" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <h2 className="text-[15px] font-semibold text-[#1b1b1f]">Change Buyer Profile</h2>
            <p className="mt-0.5 text-[12px] text-[#8b8d94] truncate max-w-[220px]">{entityName}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-[#8b8d94] hover:bg-[#ededf0] transition-colors">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-5 pb-2 space-y-1.5">
          {allProfiles.map((p) => (
            <label
              key={p._id}
              className={`flex items-center gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors ${
                selected === p._id ? "border-[#1b1b1f] bg-[#f9f9fb]" : "border-[#e6e6e9] hover:bg-[#f5f5f7]"
              }`}
            >
              <input
                type="radio"
                name="buyerProfile"
                checked={selected === p._id}
                onChange={() => setSelected(p._id)}
                className="h-3.5 w-3.5 accent-[#1b1b1f]"
              />
              <span className="text-[13px] font-medium text-[#1b1b1f]">{p.name}</span>
              {p.isDefault && <span className="ml-auto text-[11px] text-[#8b8d94]">Default</span>}
            </label>
          ))}
          <label
            className={`flex items-center gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors ${
              selected === null ? "border-[#1b1b1f] bg-[#f9f9fb]" : "border-[#e6e6e9] hover:bg-[#f5f5f7]"
            }`}
          >
            <input
              type="radio"
              name="buyerProfile"
              checked={selected === null}
              onChange={() => setSelected(null)}
              className="h-3.5 w-3.5 accent-[#1b1b1f]"
            />
            <span className="text-[13px] text-[#6b6f76]">None</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <button onClick={onClose} className="rounded-md border border-[#e6e6e9] px-3 py-1.5 text-[13px] font-medium text-[#6b6f76] hover:bg-[#f5f5f7] transition-colors">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving || selected === currentProfileId}
            className="rounded-md bg-[#1b1b1f] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#2c2c33] disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

/* ------------------------------------------------------------------ */
/*  Person Card                                                        */
/* ------------------------------------------------------------------ */

function PersonCard({
  person,
  onRemove,
  buyerProfile,
  allBuyerProfiles,
  onBuyerProfileUpdated,
  apiBaseUrl,
  authToken,
}: {
  person: PersonRecord;
  onRemove: (id: string) => void;
  buyerProfile?: BuyerProfile;
  allBuyerProfiles: BuyerProfile[];
  onBuyerProfileUpdated: (personId: string, buyerProfileId: string | null) => void;
  apiBaseUrl: string;
  authToken: string;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [showBuyerProfileModal, setShowBuyerProfileModal] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const data = getFiberData(person);
  const fullName = getFullName(data, person.linkedinUrl);
  const photoUrl = data?.profile_pic as string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentJob = data?.current_job as Record<string, any> | undefined;
  const title = currentJob?.title as string | undefined;
  const company = currentJob?.company_name as string | undefined;
  const location = data ? getLocation(data) : undefined;
  const linkedinSlug = person.linkedinUrl.split("/in/")[1]?.replace(/\/$/, "");
  const linkedinUrl = linkedinSlug ? `https://www.linkedin.com/in/${linkedinSlug}` : person.linkedinUrl;
  const status = person.enrichmentStatus;

  return (
    <>
      <div className="group relative flex items-center gap-3 rounded-lg border border-[#e6e6e9] bg-white px-3.5 py-2.5 transition-all hover:border-[#d4d4d8]">
        <Link href={`/dashboard/people/${person._id}`} className="absolute inset-0 rounded-lg" />

        {/* Photo */}
        <div className="relative shrink-0">
          <LetterAvatar name={fullName} size="md" rounded="lg" src={photoUrl} />
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="relative z-10 text-[13px] font-medium text-[#1b1b1f] hover:underline"
            >
              {fullName}
            </a>
            {status !== "completed" && (
              <span
                className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                  status === "failed" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"
                }`}
              >
                {status}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-[#8b8d94]">
            {title && <span>{title}</span>}
            {company && <span>{company}</span>}
            {location && <span>{location}</span>}
            {buyerProfile && (
              <span className="rounded-full border border-[#e6e6e9] bg-[#f5f5f7] px-2 py-0.5 text-[11px] font-medium text-[#6b6f76]">
                {buyerProfile.name}
              </span>
            )}
          </div>
        </div>

        {/* 3-dot menu */}
        <div>
          <button
            ref={menuBtnRef}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!showMenu && menuBtnRef.current) {
                const rect = menuBtnRef.current.getBoundingClientRect();
                setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
              }
              setShowMenu((v) => !v);
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[#8b8d94] transition-all hover:bg-[#ededf0] hover:text-[#6b6f76]"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
          </button>
          {showMenu && menuPos && (
            <>
              <div className="fixed inset-0 z-[150]" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowMenu(false); }} />
              <div
                className="fixed z-[200] w-44 rounded-md border border-[#e6e6e9] bg-white py-1 shadow-sm"
                style={{ top: menuPos.top, right: menuPos.right }}
              >
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowMenu(false); setShowBuyerProfileModal(true); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[#1b1b1f] hover:bg-[#f5f5f7] transition-colors"
                >
                  <svg className="h-3.5 w-3.5 text-[#6b6f76]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  Buyer Profile
                </button>
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowMenu(false); if (person._id) onRemove(person._id); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-red-600 hover:bg-red-50 transition-colors"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {showBuyerProfileModal && person._id && (
        <ChangeBuyerProfileModal
          entityName={fullName}
          currentProfileId={person.buyerProfileId ?? null}
          allProfiles={allBuyerProfiles}
          onClose={() => setShowBuyerProfileModal(false)}
          onConfirm={async (profileId) => {
            const res = await apiFetch(`${apiBaseUrl}/persons/${person._id}/buyer-profile`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
              body: JSON.stringify({ buyerProfileId: profileId }),
            });
            if (res.ok) {
              onBuyerProfileUpdated(person._id!, profileId);
              setShowBuyerProfileModal(false);
            }
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeleton Card                                                      */
/* ------------------------------------------------------------------ */

function SkeletonCard() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[#e6e6e9] bg-white px-3.5 py-2.5">
      <div className="h-10 w-10 rounded-lg animate-shimmer shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-36 rounded animate-shimmer" />
        <div className="h-3 w-24 rounded animate-shimmer" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function PeoplePage() {
  const router = useRouter();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const [authToken, setAuthToken] = useState("");
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [persons, setPersons] = useState<PersonRecord[]>([]);
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [buyerProfiles, setBuyerProfiles] = useState<BuyerProfile[]>([]);

  useEffect(() => {
    const storedToken = window.localStorage.getItem(localStorageTokenKey);
    if (!storedToken) {
      router.replace("/");
      return;
    }
    setAuthToken(storedToken);
  }, [router]);

  useEffect(() => {
    if (!authToken) return;
    void apiFetch(`${apiBaseUrl}/buyer-profiles`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async (res) => {
        const data = (await safeJson(res)) as { profiles?: BuyerProfile[] };
        setBuyerProfiles(data.profiles ?? []);
      })
      .catch(() => {});
  }, [apiBaseUrl, authToken]);

  const fetchPersons = useCallback(() => {
    if (!authToken) return;
    setIsLoadingList(true);
    void apiFetch(`${apiBaseUrl}/persons`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(async (response) => {
        const result = (await safeJson(response)) as { persons?: PersonRecord[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Could not load people");
        setPersons(result.persons ?? []);
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "Could not load people");
      })
      .finally(() => setIsLoadingList(false));
  }, [apiBaseUrl, authToken]);

  useEffect(() => { fetchPersons(); }, [fetchPersons]);

  useEffect(() => {
    const handler = () => fetchPersons();
    window.addEventListener(DATA_CHANGED_EVENT, handler);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, handler);
  }, [fetchPersons]);

  function handleBuyerProfileUpdated(personId: string, buyerProfileId: string | null) {
    setPersons((prev) => prev.map((p) => p._id === personId ? { ...p, buyerProfileId } : p));
  }

  async function handleRemovePerson(id: string) {
    try {
      const res = await apiFetch(`${apiBaseUrl}/persons/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const data = (await safeJson(res)) as { error?: string };
        throw new Error(data.error ?? "Could not remove person");
      }
      setPersons((prev) => prev.filter((p) => p._id !== id));
      dispatchDataChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not remove person");
    }
  }

  const filteredPersons = useMemo(() => {
    if (!searchQuery.trim()) return persons;
    const q = searchQuery.toLowerCase();
    return persons.filter((p) => {
      const data = getFiberData(p);
      const fullName = getFullName(data, p.linkedinUrl);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const currentJob = data?.current_job as Record<string, any> | undefined;
      const titleStr = (currentJob?.title as string | undefined) ?? "";
      const companyStr = (currentJob?.company_name as string | undefined) ?? "";
      return (
        fullName.toLowerCase().includes(q) ||
        p.linkedinUrl.toLowerCase().includes(q) ||
        titleStr.toLowerCase().includes(q) ||
        companyStr.toLowerCase().includes(q)
      );
    });
  }, [persons, searchQuery]);

  return (
    <div className="flex h-full flex-col bg-white">
      {message && (
        <div className="bg-red-50 px-6 py-2.5">
          <p className="text-[13px] text-red-600">{message}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 pt-5 pb-4">
          {/* Search bar + Add button */}
          <div className="relative mb-4 flex items-center gap-2">
            <div className="relative flex-1">
              <svg className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8b8d94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search people…"
                className="w-full rounded-md border border-[#e6e6e9] bg-white py-[7px] pl-10 pr-10 text-[14px] placeholder:text-[#8b8d94] focus:border-[#d4d4d8] focus:bg-white focus:outline-none transition-all"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#8b8d94] hover:text-[#6b6f76]">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              )}
            </div>
            <button
              onClick={() => dispatchGlobalAction("person")}
              className="flex items-center gap-1.5 rounded-md border border-[#e6e6e9] bg-white px-3 py-1.5 text-[13px] font-medium text-[#6b6f76] transition-all hover:bg-[#f5f5f7]"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add
            </button>
          </div>

          {isLoadingList ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredPersons.map((person) => (
                <PersonCard
                  key={person._id ?? person.linkedinUrl}
                  person={person}
                  onRemove={handleRemovePerson}
                  buyerProfile={person.buyerProfileId ? buyerProfiles.find((p) => p._id === person.buyerProfileId) : undefined}
                  allBuyerProfiles={buyerProfiles}
                  onBuyerProfileUpdated={handleBuyerProfileUpdated}
                  apiBaseUrl={apiBaseUrl}
                  authToken={authToken}
                />
              ))}
              {filteredPersons.length === 0 && persons.length > 0 && (
                <div className="flex items-center justify-center py-16">
                  <p className="text-[14px] text-[#8b8d94]">No results for &ldquo;{searchQuery}&rdquo;</p>
                </div>
              )}
              {persons.length === 0 && (
                <div className="flex h-64 items-center justify-center">
                  <p className="text-[14px] text-[#8b8d94]">No people yet</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
