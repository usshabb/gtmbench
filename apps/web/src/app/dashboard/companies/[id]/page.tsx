"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { LetterAvatar, safeJson, dispatchDataChanged, apiFetch } from "../../components";

interface CompanyRecord {
  _id?: string;
  userEmails: string[];
  domain: string;
  starred?: boolean;
  pipelineStage?: string | null;
  createdAt: string;
  enrichedAt?: string;
  enrichmentStatus: "pending" | "completed" | "failed";
  enrichmentData?: Record<string, unknown>;
  enrichmentError?: string;
}

interface ATSRecord {
  atsName?: string | null;
  atsUrlSlug?: string | null;
  careerPageUrl?: string | null;
  detectionStatus: "pending" | "completed" | "failed";
  detectionError?: string;
}

interface PersonRecord {
  _id?: string;
  linkedinUrl: string;
  enrichmentStatus: "pending" | "completed" | "failed";
  enrichmentData?: Record<string, unknown>;
}

interface BuyerProfile {
  _id: string;
  name: string;
  titles: string[];
  isDefault: boolean;
}

interface FiberPerson {
  primary_slug: string;
  name: string;
  first_name: string;
  last_name: string;
  headline: string;
  profile_pic: string | null;
  url: string;
  locality: string;
  current_job?: {
    title: string;
    company_name: string;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getFiberData(record: { enrichmentData?: Record<string, unknown> }): Record<string, any> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = record.enrichmentData as any;
    return raw?.output?.data?.[0] ?? null;
  } catch {
    return null;
  }
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "N/A";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return "N/A";
  return value.toLocaleString();
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "N/A";
  return new Date(iso).getFullYear().toString();
}

function formatRoundType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const localStorageTokenKey = "gtmbench-token";
function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

type TabType = "overview" | "buyers" | "open_roles" | "skills";

interface JobRecord {
  _id?: string;
  title: string;
  jobUrl?: string | null;
  location?: string | null;
  department?: string | null;
  postedAt?: string | null;
  fetchedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Buyers Tab                                                          */
/* ------------------------------------------------------------------ */

function BuyersTab({
  companyId,
  apiBaseUrl,
  authToken,
  existingPersonMap,
  onPersonAdded,
  onPersonRemoved,
}: {
  companyId: string;
  apiBaseUrl: string;
  authToken: string;
  existingPersonMap: Map<string, string>;
  onPersonAdded?: () => void;
  onPersonRemoved?: () => void;
}) {
  const [profiles, setProfiles] = useState<BuyerProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(true);
  const [buyers, setBuyers] = useState<FiberPerson[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [addingSlug, setAddingSlug] = useState<string | null>(null);
  const [addedPersonIds, setAddedPersonIds] = useState<Map<string, string>>(new Map());
  const [removingSlug, setRemovingSlug] = useState<string | null>(null);
  const [removedSlugs, setRemovedSlugs] = useState<Set<string>>(new Set());
  const [addError, setAddError] = useState("");
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [manualPersonName, setManualPersonName] = useState("");
  const [isManualAdding, setIsManualAdding] = useState(false);
  const [manualAddError, setManualAddError] = useState("");

  // Load buyer profiles
  useEffect(() => {
    void apiFetch(`${apiBaseUrl}/buyer-profiles`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(async (res) => {
        const data = (await safeJson(res)) as { profiles?: BuyerProfile[] };
        const loadedProfiles = data.profiles ?? [];
        setProfiles(loadedProfiles);
        // Select default profile, or first one
        const defaultProfile = loadedProfiles.find((p) => p.isDefault) ?? loadedProfiles[0];
        if (defaultProfile) setSelectedProfileId(defaultProfile._id);
      })
      .catch(() => {})
      .finally(() => setIsLoadingProfiles(false));
  }, [apiBaseUrl, authToken]);

  // Load cached buyers when profile selection changes
  useEffect(() => {
    if (!selectedProfileId) return;
    setBuyers([]);
    setHasSearched(false);
    setFetchedAt(null);
    setNextCursor(null);
    setSearchError("");

    void apiFetch(`${apiBaseUrl}/companies/${companyId}/buyers?buyerProfileId=${selectedProfileId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(async (res) => {
        const data = (await safeJson(res)) as {
          result?: { buyers?: FiberPerson[]; fetchedAt?: string; nextCursor?: string | null } | null;
        };
        if (data.result) {
          setBuyers((data.result.buyers ?? []) as FiberPerson[]);
          setFetchedAt(data.result.fetchedAt ?? null);
          setNextCursor(data.result.nextCursor ?? null);
          setHasSearched(true);
        }
      })
      .catch(() => {});
  }, [apiBaseUrl, authToken, companyId, selectedProfileId]);

  async function handleSearch(cursor: string | null = null) {
    if (!selectedProfileId) return;

    if (cursor) {
      setIsLoadingMore(true);
    } else {
      setIsSearching(true);
      setBuyers([]);
      setNextCursor(null);
    }
    setSearchError("");

    try {
      const response = await apiFetch(`${apiBaseUrl}/companies/${companyId}/find-buyers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ buyerProfileId: selectedProfileId, cursor }),
      });

      const data = (await safeJson(response)) as {
        result?: { output?: { data?: FiberPerson[]; nextCursor?: string | null } };
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Search failed");

      const newBuyers = (data.result?.output?.data ?? []) as FiberPerson[];
      if (cursor) {
        setBuyers((prev) => [...prev, ...newBuyers]);
      } else {
        setBuyers(newBuyers);
        setFetchedAt(new Date().toISOString());
      }
      setNextCursor(data.result?.output?.nextCursor ?? null);
      setHasSearched(true);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setIsSearching(false);
      setIsLoadingMore(false);
    }
  }

  function formatFetchedAt(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  async function handleAddPerson(person: FiberPerson) {
    setAddingSlug(person.primary_slug);
    setAddError("");

    const linkedinUrl = `https://www.linkedin.com/in/${person.primary_slug}`;

    try {
      const response = await apiFetch(`${apiBaseUrl}/persons`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ linkedinUrl, buyerProfileId: selectedProfileId, companyId }),
      });

      if (!response.ok) {
        const data = (await safeJson(response)) as { error?: string };
        // 409 means already exists — that's fine, treat as success
        if (response.status !== 409) throw new Error(data.error ?? "Could not add person");
      }

      const data = (await safeJson(response)) as { person?: { _id?: string } };
      const personId = data?.person?._id;
      setAddedPersonIds((prev) => {
        const next = new Map(prev);
        if (personId) next.set(person.primary_slug, personId);
        return next;
      });
      setRemovedSlugs((prev) => { const next = new Set(prev); next.delete(person.primary_slug); return next; });
      dispatchDataChanged();
      onPersonAdded?.();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Could not add person");
    } finally {
      setAddingSlug(null);
    }
  }

  async function handleRemovePerson(slug: string) {
    const personId = existingPersonMap.get(slug) ?? addedPersonIds.get(slug);
    if (!personId) return;
    setRemovingSlug(slug);
    try {
      const res = await apiFetch(`${apiBaseUrl}/persons/${personId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const data = (await safeJson(res)) as { error?: string };
        throw new Error(data.error ?? "Could not remove person");
      }
      setRemovedSlugs((prev) => new Set(prev).add(slug));
      dispatchDataChanged();
      onPersonRemoved?.();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Could not remove person");
    } finally {
      setRemovingSlug(null);
    }
  }

  async function handleManualAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = manualInput.trim();
    if (!input) return;
    setIsManualAdding(true);
    setManualAddError("");
    const isEmailInput = input.includes("@") && !input.includes("linkedin.com");
    try {
      const endpoint = isEmailInput ? `${apiBaseUrl}/persons/by-email` : `${apiBaseUrl}/persons`;
      const body = isEmailInput
        ? { email: input, name: manualPersonName.trim() || undefined, companyId, buyerProfileId: selectedProfileId || undefined }
        : { linkedinUrl: input.startsWith("http") ? input : `https://www.linkedin.com/in/${input}`, companyId, buyerProfileId: selectedProfileId || undefined };
      const res = await apiFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(body),
      });
      const data = (await safeJson(res)) as { person?: { _id?: string }; error?: string };
      if (!res.ok && res.status !== 409) throw new Error(data.error ?? "Could not add person");
      setManualInput("");
      setManualPersonName("");
      setShowManualAdd(false);
      dispatchDataChanged();
      onPersonAdded?.();
    } catch (err) {
      setManualAddError(err instanceof Error ? err.message : "Could not add person");
    } finally {
      setIsManualAdding(false);
    }
  }

  if (isLoadingProfiles) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#d4d4d8] border-t-[#6b6f76]" />
      </div>
    );
  }

  if (profiles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-[#f5f5f7]">
          <svg className="h-6 w-6 text-[#8b8d94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15A2.25 2.25 0 002.25 6.75v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
          </svg>
        </div>
        <p className="text-[13px] font-medium text-[#6b6f76]">No buyer profiles yet</p>
        <p className="mt-1 text-[12px] text-[#8b8d94]">Create a buyer profile first to search for buyers</p>
        <Link
          href="/dashboard/buyer-profiles"
          className="mt-4 rounded-lg bg-[#1b1b1f] px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
        >
          Go to Buyer Profiles
        </Link>
      </div>
    );
  }

  const selectedProfile = profiles.find((p) => p._id === selectedProfileId);

  return (
    <div>
      {/* Controls */}
      <div className="rounded-lg border border-[#e6e6e9] bg-white">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="relative min-w-0 flex-1">
            <button
              onClick={() => setShowProfileDropdown((v) => !v)}
              className="flex w-full items-center justify-between rounded-lg border border-[#e6e6e9] bg-[#f9f9fb] px-3 py-2 text-left text-[13px] text-[#6b6f76] transition-all hover:bg-[#ededf0]"
            >
              <span className="truncate">{selectedProfile?.name ?? "Select profile"}{selectedProfile?.isDefault ? " (Default)" : ""}</span>
              <svg className={`h-3.5 w-3.5 shrink-0 text-[#8b8d94] transition-transform ${showProfileDropdown ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
            </button>
            {showProfileDropdown && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setShowProfileDropdown(false)} />
                <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-lg border border-[#e6e6e9] bg-white py-1 shadow-lg">
                  {profiles.map((p) => (
                    <button
                      key={p._id}
                      onClick={() => { setSelectedProfileId(p._id); setShowProfileDropdown(false); }}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] text-[#6b6f76] transition-colors hover:bg-[#f5f5f7]"
                    >
                      <span>{p.name}{p.isDefault ? " (Default)" : ""}</span>
                      {p._id === selectedProfileId && (
                        <svg className="h-4 w-4 text-[#6b6f76]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => handleSearch()}
            disabled={isSearching || !selectedProfileId}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#e6e6e9] bg-white px-3 py-2 text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7] disabled:opacity-60"
          >
            {isSearching ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#d4d4d8] border-t-[#6b6f76]" />
                Searching...
              </>
            ) : hasSearched ? (
              <>
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
                Refresh
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                Find Buyers
              </>
            )}
          </button>
          <button
            onClick={() => { setShowManualAdd((v) => !v); setManualAddError(""); setManualInput(""); setManualPersonName(""); }}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors ${showManualAdd ? "border-[#1b1b1f] bg-[#1b1b1f] text-white" : "border-[#e6e6e9] bg-white text-[#6b6f76] hover:bg-[#f5f5f7]"}`}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add
          </button>
        </div>
        {/* Profile titles + last fetched */}
        {selectedProfile && selectedProfile.titles.length > 0 && (
          <div className="flex items-center gap-2 border-t border-[#e6e6e9] px-4 py-2.5">
            <div className="flex flex-1 flex-wrap items-center gap-1.5">
              {selectedProfile.titles.map((t, i) => (
                <span key={i} className="rounded-md bg-[#f5f5f7] px-2.5 py-0.5 text-[11px] font-medium text-[#6b6f76]">{t}</span>
              ))}
            </div>
            {fetchedAt && !isSearching && (
              <span className="shrink-0 text-[11px] text-[#8b8d94]">{formatFetchedAt(fetchedAt)}</span>
            )}
          </div>
        )}
      </div>

      {/* Manual add form */}
      {showManualAdd && (
        <form onSubmit={handleManualAdd} className="mt-3 rounded-lg border border-[#e6e6e9] bg-white p-3 space-y-2">
          <p className="text-[12px] font-medium text-[#6b6f76]">Add person by LinkedIn URL or email</p>
          <input
            type="text"
            value={manualInput}
            onChange={(e) => { setManualInput(e.target.value); setManualPersonName(""); }}
            placeholder="linkedin.com/in/... or name@company.com"
            className="w-full rounded-lg border border-[#e6e6e9] bg-white px-3 py-2 text-[13px] placeholder:text-[#b4b5ba] focus:border-[#5e6ad2] focus:outline-none focus:ring-2 focus:ring-[#5e6ad2]/10 transition-all"
            autoFocus
          />
          {manualInput.includes("@") && !manualInput.includes("linkedin.com") && (
            <input
              type="text"
              value={manualPersonName}
              onChange={(e) => setManualPersonName(e.target.value)}
              placeholder="Full name (optional)"
              className="w-full rounded-lg border border-[#e6e6e9] bg-white px-3 py-2 text-[13px] placeholder:text-[#b4b5ba] focus:border-[#5e6ad2] focus:outline-none focus:ring-2 focus:ring-[#5e6ad2]/10 transition-all"
            />
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setShowManualAdd(false); setManualInput(""); setManualPersonName(""); setManualAddError(""); }}
              className="text-[13px] text-[#8b8d94] transition-colors hover:text-[#6b6f76]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isManualAdding || !manualInput.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-[#1b1b1f] px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#2c2c33] disabled:opacity-60"
            >
              {isManualAdding ? (
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : manualInput.includes("@") && !manualInput.includes("linkedin.com") ? "Add" : "Look up & add"}
            </button>
          </div>
          {manualAddError && <p className="text-[12px] text-red-600">{manualAddError}</p>}
        </form>
      )}

      {/* Error */}
      {searchError && (
        <div className="mt-3 rounded-lg bg-red-50 px-4 py-3">
          <p className="text-[13px] text-red-600">{searchError}</p>
        </div>
      )}

      {addError && (
        <div className="mt-2 rounded-lg bg-red-50 px-4 py-2">
          <p className="text-[13px] text-red-600">{addError}</p>
        </div>
      )}

      {/* Results */}
      {hasSearched && !isSearching && (
        <div className="mt-4">
          <p className="mb-2 text-[12px] text-[#8b8d94]">
            {buyers.length} {buyers.length === 1 ? "buyer" : "buyers"} found
          </p>

          {buyers.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-[13px] text-[#6b6f76]">No buyers found matching this profile at this company</p>
            </div>
          ) : (
            <div className="rounded-lg border border-[#e6e6e9] bg-white divide-y divide-[#e6e6e9]">
              {buyers.map((person) => {
                const isAdded = (addedPersonIds.has(person.primary_slug) || existingPersonMap.has(person.primary_slug)) && !removedSlugs.has(person.primary_slug);
                const isAdding = addingSlug === person.primary_slug;
                const isRemoving = removingSlug === person.primary_slug;
                return (
                  <div
                    key={person.primary_slug}
                    className={`flex items-center gap-3 px-4 py-3 transition-colors ${isAdded ? "bg-[#f9f9fb]" : ""}`}
                  >
                    <LetterAvatar name={person.name ?? person.first_name ?? "?"} size="sm" src={person.profile_pic} />
                    <div className="min-w-0 flex-1">
                      <span className="text-[13px] font-medium text-[#1b1b1f]">{person.name}</span>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-[#6b6f76]">
                        {person.current_job?.title && <span>{person.current_job.title}</span>}
                        {person.headline && !person.current_job?.title && <span>{person.headline}</span>}
                        {person.locality && <span>{person.locality}</span>}
                      </div>
                    </div>

                    {isAdded ? (
                      <button
                        onClick={() => handleRemovePerson(person.primary_slug)}
                        disabled={isRemoving}
                        className="group/remove flex shrink-0 items-center gap-1 rounded-md bg-[#f5f5f7] px-2.5 py-1 text-[12px] font-medium text-[#6b6f76] transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
                      >
                        {isRemoving ? (
                          <div className="h-3 w-3 animate-spin rounded-full border-2 border-[#d4d4d8] border-t-[#6b6f76]" />
                        ) : (
                          <>
                            <svg className="h-3 w-3 group-hover/remove:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                            <svg className="hidden h-3 w-3 group-hover/remove:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            <span className="group-hover/remove:hidden">Added</span>
                            <span className="hidden group-hover/remove:inline">Remove</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleAddPerson(person)}
                        disabled={isAdding}
                        className="flex shrink-0 items-center gap-1 rounded-md border border-[#e6e6e9] px-2.5 py-1 text-[12px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7] disabled:opacity-60"
                      >
                        {isAdding ? (
                          <div className="h-3 w-3 animate-spin rounded-full border-2 border-[#d4d4d8] border-t-[#6b6f76]" />
                        ) : (
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                          </svg>
                        )}
                        Add
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Load More */}
          {nextCursor && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => handleSearch(nextCursor)}
                disabled={isLoadingMore}
                className="rounded-lg border border-[#e6e6e9] bg-white px-4 py-2 text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7] disabled:opacity-60"
              >
                {isLoadingMore ? "Loading..." : "Load More"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Jobs Tab                                                             */
/* ------------------------------------------------------------------ */

function JobsTab({
  companyId,
  apiBaseUrl,
  authToken,
}: {
  companyId: string;
  apiBaseUrl: string;
  authToken: string;
}) {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void apiFetch(`${apiBaseUrl}/companies/${companyId}/jobs`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load jobs");
        const data = (await safeJson(res)) as { jobs?: JobRecord[] };
        setJobs(data.jobs ?? []);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load jobs");
      })
      .finally(() => setIsLoading(false));
  }, [apiBaseUrl, authToken, companyId]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#d4d4d8] border-t-[#6b6f76]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 px-4 py-3">
        <p className="text-[13px] text-red-600">{error}</p>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-[#f5f5f7]">
          <svg className="h-6 w-6 text-[#8b8d94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <p className="text-[13px] font-medium text-[#6b6f76]">No jobs found</p>
        <p className="mt-1 text-[12px] text-[#8b8d94]">Jobs will appear here once they are fetched via ATS detection</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#8b8d94]">
        {jobs.length} {jobs.length === 1 ? "job" : "jobs"} posted
      </h3>
      <div className="space-y-1">
        {jobs.map((job) => (
          <div
            key={job._id ?? job.jobUrl ?? job.title}
            className="flex items-center gap-3 rounded-lg border border-[#e6e6e9] px-4 py-3 transition-colors hover:bg-[#f5f5f7]"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f5f5f7]">
              <svg className="h-4 w-4 text-[#8b8d94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-[#1b1b1f]">{job.title}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-[#6b6f76]">
                {job.department && <span>{job.department}</span>}
                {job.location && (
                  <span className="flex items-center gap-1">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    {job.location}
                  </span>
                )}
                {job.postedAt && (
                  <span>Posted {new Date(job.postedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                )}
              </div>
            </div>
            {job.jobUrl && (
              <a
                href={job.jobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-lg border border-[#e6e6e9] px-3 py-1.5 text-[12px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7]"
              >
                View
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Company Detail Page                                                 */
/* ------------------------------------------------------------------ */

export default function CompanyDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const [authToken, setAuthToken] = useState("");
  const [company, setCompany] = useState<CompanyRecord | null>(null);
  const [persons, setPersons] = useState<PersonRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [isRemoving, setIsRemoving] = useState(false);
  const [atsData, setATSData] = useState<ATSRecord | null>(null);
  const [isDetectingATS, setIsDetectingATS] = useState(false);
  const [enabledSkills, setEnabledSkills] = useState<{ _id: string; skillType: string; enabled: boolean }[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const [activeMetric, setActiveMetric] = useState(0);
  const [toggingStar, setTogglingStar] = useState(false);

  const existingPersonMap = useMemo(() => {
    const map = new Map<string, string>();
    persons.forEach((p) => {
      const slug = p.linkedinUrl?.split("/in/")?.[1]?.replace(/\/$/, "");
      if (slug && p._id) map.set(slug, p._id);
    });
    return map;
  }, [persons]);

  async function handleToggleStar() {
    if (!authToken || !id || toggingStar) return;
    setTogglingStar(true);
    try {
      const res = await apiFetch(`${apiBaseUrl}/companies/${id}/star`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = (await safeJson(res)) as { starred: boolean };
        setCompany((prev) => prev ? { ...prev, starred: data.starred } : prev);
      }
    } catch {
      // ignore
    } finally {
      setTogglingStar(false);
    }
  }

  async function handleRemove() {
    if (!authToken || !id) return;
    setIsRemoving(true);
    try {
      const res = await apiFetch(`${apiBaseUrl}/companies/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const data = (await safeJson(res)) as { error?: string };
        throw new Error(data.error ?? "Could not remove company");
      }
      dispatchDataChanged();
      router.replace("/dashboard/companies");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove company");
      setIsRemoving(false);
    }
  }

  useEffect(() => {
    const storedToken = window.localStorage.getItem(localStorageTokenKey);
    if (!storedToken) { router.replace("/"); return; }
    setAuthToken(storedToken);
  }, [router]);

  // Fetch enabled skills
  useEffect(() => {
    if (!authToken) return;
    void apiFetch(`${apiBaseUrl}/skills`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(async (res) => {
        const data = (await safeJson(res)) as { skills?: { _id: string; skillType: string; enabled: boolean }[] };
        setEnabledSkills((data.skills ?? []).filter((s) => s.enabled));
      })
      .catch(() => {});
  }, [apiBaseUrl, authToken]);

  useEffect(() => {
    if (!authToken || !id) return;

    Promise.all([
      apiFetch(`${apiBaseUrl}/companies/${id}`, { headers: { Authorization: `Bearer ${authToken}` } }),
      apiFetch(`${apiBaseUrl}/companies/${id}/persons`, { headers: { Authorization: `Bearer ${authToken}` } }),
      apiFetch(`${apiBaseUrl}/companies/${id}/ats`, { headers: { Authorization: `Bearer ${authToken}` } }),
    ])
      .then(async ([companyRes, personsRes, atsRes]) => {
        if (!companyRes.ok) throw new Error("Company not found");
        const companyData = (await safeJson(companyRes)) as { company: CompanyRecord };
        setCompany(companyData.company);

        if (personsRes.ok) {
          const personsData = (await safeJson(personsRes)) as { persons: PersonRecord[] };
          setPersons(personsData.persons ?? []);
        }

        if (atsRes.ok) {
          const atsDataResponse = (await safeJson(atsRes)) as { ats: ATSRecord | null };
          setATSData(atsDataResponse.ats);
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load company");
      })
      .finally(() => setIsLoading(false));
  }, [apiBaseUrl, authToken, id]);

  function refreshPersons() {
    if (!authToken || !id) return;
    void apiFetch(`${apiBaseUrl}/companies/${id}/persons`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async (res) => {
        if (res.ok) {
          const data = (await safeJson(res)) as { persons: PersonRecord[] };
          setPersons(data.persons ?? []);
        }
      })
      .catch(() => {});
  }

  async function handleDetectATS() {
    if (!authToken || !id) return;
    setIsDetectingATS(true);
    try {
      const res = await apiFetch(`${apiBaseUrl}/companies/${id}/detect-ats`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
      });
      if (!res.ok) {
        const data = (await safeJson(res)) as { error?: string };
        throw new Error(data.error ?? "Could not detect ATS");
      }
      const result = (await safeJson(res)) as { ats: ATSRecord };
      setATSData(result.ats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not detect ATS");
    } finally {
      setIsDetectingATS(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#d4d4d8] border-t-[#6b6f76]" />
      </div>
    );
  }

  if (error || !company) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-[#6b6f76]">{error || "Company not found"}</p>
        <button onClick={() => router.back()} className="text-sm text-[#6b6f76] underline hover:text-[#1b1b1f]">Go back</button>
      </div>
    );
  }

  const data = getFiberData(company);
  const name = (data?.preferred_name ?? company.domain) as string;
  const logoUrl = data?.logo_url as string | undefined;
  const headline = data?.li_headline as string | undefined;
  const description = (data?.short_description ?? data?.li_description) as string | undefined;
  const location = data?.location_consensus?.formatted_address as string | undefined;
  const industry = (data?.standard_industries as string[] | undefined)?.[0];
  const employees = data?.employee_count_consensus?.gte as number | undefined;
  const revenue = data?.revenue_usd as number | undefined;
  const totalFunding = data?.total_funding_consensus as number | undefined;
  const peakValuation = data?.funding_round_stats?.peak_valuation_usd as number | undefined;
  const founded = data?.founded_on_consensus as string | undefined;
  const fundingStage = data?.funding_stage as string | undefined;
  const linkedinSlug = data?.linkedin_primary_slug as string | undefined;
  const twitterHandle = (data?.twitter_handles as string[] | undefined)?.[0];
  const website = (data?.websites as string[] | undefined)?.[0];
  const crunchbaseRank = data?.crunchbase_rank as number | undefined;

  const investorStats = data?.funding_round_stats?.individual_investor_stats as
    | { investor_name: string; investor_type: string; investment_count: number }[]
    | undefined;
  const topInvestors = investorStats
    ?.filter((i) => i.investor_type === "organization")
    .sort((a, b) => b.investment_count - a.investment_count)
    .slice(0, 8);

  const fundingRounds = (data?.full_funding_rounds as {
    round_type: string;
    round_date: string;
    round_raised_usd: number | null;
    round_valuation_usd: number | null;
  }[] | undefined)
    ?.filter((r) => !["debt_financing", "secondary_market"].includes(r.round_type))
    .sort((a, b) => new Date(b.round_date).getTime() - new Date(a.round_date).getTime())
    .slice(0, 6);

  const acquisitions = data?.acquisitions as
    | { acquiree_name: string; acquisition_date: string; price_usd: number | null }[]
    | undefined;

  const statItems = [
    { label: "Employees", value: employees != null ? formatNumber(employees) : null },
    { label: "Revenue", value: revenue != null ? formatCurrency(revenue) : null },
    { label: "Total Funding", value: totalFunding != null ? formatCurrency(totalFunding) : null },
    { label: "Peak Valuation", value: peakValuation != null ? formatCurrency(peakValuation) : null },
    { label: "Founded", value: founded ? formatDate(founded) : null },
    { label: "Stage", value: fundingStage ? fundingStage.replace(/_/g, " ") : null },
    { label: "CB Rank", value: crunchbaseRank != null ? `#${crunchbaseRank}` : null },
    { label: "Industry", value: industry ?? null },
  ].filter((s) => s.value != null);

  const tabs: { key: TabType; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "buyers", label: "Buyers" },
    { key: "open_roles", label: "Open Roles" },
    { key: "skills", label: "Skills" },
  ];

  const employeesStr = employees != null ? employees.toLocaleString() : null;
  const fundingStr = totalFunding != null ? formatCurrency(totalFunding) : null;
  const hasATS = atsData?.detectionStatus === "completed" && atsData.atsName;
  const hasDetectATS = enabledSkills.some((s) => s.skillType === "detect_ats");

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="mx-auto max-w-3xl px-4 pt-6 pb-8">
        {/* Header card with 3-dot menu */}
        <div className="group relative flex items-center gap-4 rounded-lg border border-[#e6e6e9] bg-white px-4 py-3">
          <LetterAvatar name={name} size="lg" rounded="lg" src={logoUrl} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleToggleStar}
                disabled={toggingStar}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[#f5f5f7] disabled:opacity-50"
                title={company.starred ? "Remove from pipeline" : "Add to pipeline"}
              >
                {company.starred ? (
                  <svg className="h-4.5 w-4.5 text-amber-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                ) : (
                  <svg className="h-4.5 w-4.5 text-[#d4d4d8] hover:text-[#8b8d94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                )}
              </button>
              <h1 className="text-[16px] font-semibold text-[#1b1b1f]">{name}</h1>
              {company.domain && <span className="text-[12px] text-[#8b8d94]">{company.domain}</span>}
              {isDetectingATS && (
                <span className="flex items-center gap-1 text-[11px] text-[#8b8d94]">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-[#d4d4d8] border-t-[#6b6f76]" />
                  Detecting…
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-[#8b8d94]">
              {industry && <span>{industry}</span>}
              {industry && location && <span>·</span>}
              {location && (
                <span className="flex items-center gap-1">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  {location}
                </span>
              )}
            </div>
            {/* Pills */}
            <div className="mt-2 flex flex-wrap gap-2">
              {employeesStr && (
                <span className="rounded-full border border-[#e6e6e9] bg-[#f9f9fb] px-3 py-0.5 text-[11px] font-medium text-[#6b6f76]">{employeesStr} People</span>
              )}
              {fundingStr && (
                <span className="rounded-full border border-[#e6e6e9] bg-[#f9f9fb] px-3 py-0.5 text-[11px] font-medium text-[#6b6f76]">{fundingStr} Raised</span>
              )}
              {website && (
                <a href={`https://${website}`} target="_blank" rel="noopener noreferrer" className="rounded-full border border-[#e6e6e9] bg-[#f9f9fb] px-3 py-0.5 text-[11px] font-medium text-[#6b6f76] hover:bg-[#ededf0] transition-colors">{website}</a>
              )}
              {linkedinSlug && (
                <a href={`https://linkedin.com/company/${linkedinSlug}`} target="_blank" rel="noopener noreferrer" className="rounded-full border border-[#e6e6e9] bg-[#f9f9fb] px-3 py-0.5 text-[11px] font-medium text-[#6b6f76] hover:bg-[#ededf0] transition-colors">LinkedIn</a>
              )}
              {twitterHandle && (
                <a href={`https://x.com/${twitterHandle}`} target="_blank" rel="noopener noreferrer" className="rounded-full border border-[#e6e6e9] bg-[#f9f9fb] px-3 py-0.5 text-[11px] font-medium text-[#6b6f76] hover:bg-[#ededf0] transition-colors">@{twitterHandle}</a>
              )}
            </div>
          </div>
          {/* 3-dot menu */}
          <div className="relative self-start">
            <button
              onClick={() => setShowMenu((v) => !v)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-[#8b8d94] transition-all hover:bg-[#ededf0] hover:text-[#6b6f76]"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-8 z-30 w-36 rounded-lg border border-[#e6e6e9] bg-white py-1 shadow-lg">
                  <button
                    onClick={() => { setShowMenu(false); handleRemove(); }}
                    disabled={isRemoving}
                    className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    {isRemoving ? "Removing…" : "Delete"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex gap-0 border-b border-[#e6e6e9]">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 -mb-px text-[13px] font-medium transition-colors ${
                activeTab === tab.key
                  ? "text-[#1b1b1f] border-b-2 border-[#1b1b1f] bg-transparent"
                  : "text-[#8b8d94] hover:text-[#6b6f76] bg-transparent border-none"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "overview" ? (
          <div>
            {/* Overview card — description + key metrics */}
            {(description || statItems.length > 0) && (
              <div className="mt-6 rounded-lg border border-[#e6e6e9] bg-white">
                {description && (
                  <div className={`px-5 py-4${statItems.length > 0 ? " border-b border-[#e6e6e9]" : ""}`}>
                    <p className="text-sm leading-relaxed text-[#6b6f76]">{description}</p>
                  </div>
                )}
                {statItems.length > 0 && (
                  <div className="px-4 py-3 flex flex-wrap gap-2">
                    {statItems.map((stat) => (
                      <span key={stat.label} className="rounded-md border border-[#e6e6e9] bg-[#f9f9fb] px-3 py-1.5 text-[12px]">
                        <span className="text-[#8b8d94]">{stat.label}</span>
                        <span className="ml-1.5 font-semibold capitalize text-[#1b1b1f]">{stat.value}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Funding — single component with timeline + investors */}
            {((fundingRounds && fundingRounds.length > 0) || (topInvestors && topInvestors.length > 0)) && (
              <div className="mt-6 rounded-lg border border-[#e6e6e9] bg-white">
                <div className="px-4 py-3 border-b border-[#e6e6e9]">
                  <h2 className="text-[13px] font-medium text-[#6b6f76]">Funding</h2>
                </div>
                {/* Timeline */}
                {fundingRounds && fundingRounds.length > 0 && (
                  <div className="px-4 py-3">
                    <div className="relative">
                      {fundingRounds.map((round, i) => (
                        <div key={i} className="flex items-start gap-3 pb-3 last:pb-0">
                          {/* Timeline dot + line */}
                          <div className="flex flex-col items-center pt-1.5">
                            <div className="h-2 w-2 rounded-full bg-[#d4d4d8] shrink-0" />
                            {i < fundingRounds.length - 1 && <div className="w-px flex-1 bg-[#e6e6e9] mt-1" style={{ minHeight: 20 }} />}
                          </div>
                          <div className="flex flex-1 items-center justify-between min-w-0">
                            <div>
                              <span className="text-[13px] font-medium text-[#1b1b1f]">{formatRoundType(round.round_type)}</span>
                              <span className="ml-2 text-[12px] text-[#8b8d94]">{new Date(round.round_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
                            </div>
                            <div className="flex items-center gap-2 text-right">
                              {round.round_raised_usd != null && <span className="text-[13px] text-[#6b6f76]">{formatCurrency(round.round_raised_usd)}</span>}
                              {round.round_valuation_usd != null && <span className="text-[11px] text-[#8b8d94]">@ {formatCurrency(round.round_valuation_usd)}</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Key Investors */}
                {topInvestors && topInvestors.length > 0 && (
                  <div className="px-4 py-3 border-t border-[#e6e6e9]">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-[#8b8d94] mb-2">Key Investors</p>
                    <div className="flex flex-wrap gap-1.5">
                      {topInvestors.map((inv) => (
                        <span key={inv.investor_name} className="rounded-md bg-[#f5f5f7] px-2.5 py-1 text-xs font-medium text-[#6b6f76]">{inv.investor_name}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Acquisitions */}
            {acquisitions && acquisitions.length > 0 && (
              <div className="mt-6 rounded-lg border border-[#e6e6e9] bg-white">
                <div className="px-4 py-3 border-b border-[#e6e6e9]">
                  <h2 className="text-[13px] font-medium text-[#6b6f76]">Acquisitions</h2>
                </div>
                <div className="divide-y divide-[#e6e6e9]">
                  {acquisitions.map((acq, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-3 text-sm">
                      <span className="font-medium text-[#1b1b1f]">{acq.acquiree_name}</span>
                      <div className="flex items-center gap-2">
                        {acq.price_usd != null && <span className="text-[#6b6f76]">{formatCurrency(acq.price_usd)}</span>}
                        <span className="text-xs text-[#8b8d94]">{new Date(acq.acquisition_date).getFullYear()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* People at this company */}
            {persons.length > 0 && (
              <div className="mt-6">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#8b8d94]">
                  Enriched People at {name} ({persons.length})
                </h2>
                <div className="space-y-1">
                  {persons.map((person) => {
                    const pData = getFiberData(person);
                    const pName = pData?.name ?? pData?.first_name ? `${pData?.first_name ?? ""} ${pData?.last_name ?? ""}`.trim() : person.linkedinUrl.split("/in/")[1]?.replace(/\/$/, "") ?? "Unknown";
                    const photoUrl = pData?.profile_pic as string | undefined;
                    const title = pData?.current_job?.title as string | undefined;
                    return (
                      <Link
                        key={person._id}
                        href={`/dashboard/people/${person._id}`}
                        className="flex items-center gap-3 rounded-lg border border-[#e6e6e9] px-4 py-3 transition-colors hover:bg-[#f5f5f7]"
                      >
                        <LetterAvatar name={pName} size="xs" src={photoUrl} />
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-medium text-[#1b1b1f]">{pName}</span>
                          {title && <span className="ml-2 text-xs text-[#6b6f76]">{title}</span>}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : activeTab === "buyers" ? (
          <div className="mt-6">
            <BuyersTab companyId={id} apiBaseUrl={apiBaseUrl} authToken={authToken} existingPersonMap={existingPersonMap} onPersonAdded={refreshPersons} onPersonRemoved={refreshPersons} />
          </div>
        ) : activeTab === "open_roles" ? (
          <div className="mt-6">
            <JobsTab companyId={id} apiBaseUrl={apiBaseUrl} authToken={authToken} />
          </div>
        ) : (
          /* Skills tab — horizontal row of skills */
          <div className="mt-6">
            <div className="space-y-3">
              {hasDetectATS && (
                hasATS ? (
                  <div className="flex items-center gap-3 rounded-lg border border-[#e6e6e9] bg-white px-4 py-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#ecfdf5]">
                      <svg className="h-4 w-4 text-[#059669]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                    </div>
                    <div className="flex-1">
                      <p className="text-[13px] font-medium text-[#6b6f76]">ATS Detected</p>
                      <p className="text-[11px] text-[#8b8d94]">{atsData?.atsName}</p>
                    </div>
                    {atsData?.careerPageUrl && (
                      <a
                        href={atsData.careerPageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg border border-[#e6e6e9] px-3 py-1.5 text-[12px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7]"
                      >
                        Career Page
                      </a>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={handleDetectATS}
                    disabled={isDetectingATS}
                    className="flex w-full items-center gap-3 rounded-lg border border-[#e6e6e9] bg-white px-4 py-3 text-left transition-colors hover:bg-[#f5f5f7] disabled:opacity-60"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f5f5f7]">
                      <svg className="h-4 w-4 text-[#6b6f76]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-[13px] font-medium text-[#1b1b1f]">{isDetectingATS ? "Detecting…" : atsData?.detectionStatus === "failed" ? "Retry Detect ATS" : "Detect ATS"}</p>
                      <p className="text-[11px] text-[#8b8d94]">Find this company&apos;s hiring system</p>
                    </div>
                  </button>
                )
              )}
              {enabledSkills.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <p className="text-[13px] text-[#8b8d94]">No skills enabled. Enable skills in the Skills page.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
