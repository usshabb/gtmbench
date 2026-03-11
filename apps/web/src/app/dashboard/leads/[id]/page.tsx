"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { LetterAvatar } from "../../components";

interface LeadRecord {
  _id?: string;
  userEmails: string[];
  domain: string;
  createdAt: string;
  enrichedAt?: string;
  enrichmentStatus: "pending" | "completed" | "failed";
  enrichmentData?: Record<string, unknown>;
  enrichmentError?: string;
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
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

type TabType = "overview" | "buyers";

/* ------------------------------------------------------------------ */
/*  Buyers Tab                                                          */
/* ------------------------------------------------------------------ */

function BuyersTab({
  leadId,
  apiBaseUrl,
  authToken,
}: {
  leadId: string;
  apiBaseUrl: string;
  authToken: string;
}) {
  const [profiles, setProfiles] = useState<BuyerProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(true);
  const [buyers, setBuyers] = useState<FiberPerson[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [addingSlug, setAddingSlug] = useState<string | null>(null);
  const [addedSlugs, setAddedSlugs] = useState<Set<string>>(new Set());
  const [addError, setAddError] = useState("");

  // Load buyer profiles
  useEffect(() => {
    void fetch(`${apiBaseUrl}/buyer-profiles`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(async (res) => {
        const data = (await res.json()) as { profiles?: BuyerProfile[] };
        const loadedProfiles = data.profiles ?? [];
        setProfiles(loadedProfiles);
        // Select default profile, or first one
        const defaultProfile = loadedProfiles.find((p) => p.isDefault) ?? loadedProfiles[0];
        if (defaultProfile) setSelectedProfileId(defaultProfile._id);
      })
      .catch(() => {})
      .finally(() => setIsLoadingProfiles(false));
  }, [apiBaseUrl, authToken]);

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
      const response = await fetch(`${apiBaseUrl}/leads/${leadId}/find-buyers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ buyerProfileId: selectedProfileId, cursor }),
      });

      const data = (await response.json()) as {
        result?: { output?: { data?: FiberPerson[]; nextCursor?: string | null } };
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Search failed");

      const newBuyers = (data.result?.output?.data ?? []) as FiberPerson[];
      if (cursor) {
        setBuyers((prev) => [...prev, ...newBuyers]);
      } else {
        setBuyers(newBuyers);
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

  async function handleAddPerson(person: FiberPerson) {
    setAddingSlug(person.primary_slug);
    setAddError("");

    const linkedinUrl = `https://www.linkedin.com/in/${person.primary_slug}`;

    try {
      const response = await fetch(`${apiBaseUrl}/persons`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ linkedinUrl }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        // 409 means already exists — that's fine, treat as success
        if (response.status !== 409) throw new Error(data.error ?? "Could not add person");
      }

      setAddedSlugs((prev) => new Set(prev).add(person.primary_slug));
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Could not add person");
    } finally {
      setAddingSlug(null);
    }
  }

  if (isLoadingProfiles) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
      </div>
    );
  }

  if (profiles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100">
          <svg className="h-6 w-6 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15A2.25 2.25 0 002.25 6.75v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
          </svg>
        </div>
        <p className="text-[13px] font-medium text-zinc-600">No buyer profiles yet</p>
        <p className="mt-1 text-[12px] text-zinc-400">Create a buyer profile first to search for buyers</p>
        <Link
          href="/dashboard/buyer-profiles"
          className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
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
      <div className="flex items-center gap-3 rounded-xl border border-zinc-100 bg-zinc-50/50 p-4">
        <div className="min-w-0 flex-1">
          <label className="block text-[11px] font-medium uppercase tracking-wide text-zinc-400 mb-1.5">Buyer Profile</label>
          <select
            value={selectedProfileId}
            onChange={(e) => setSelectedProfileId(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-700 focus:border-zinc-400 focus:outline-none"
          >
            {profiles.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}{p.isDefault ? " (Default)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="pt-5">
          <button
            onClick={() => handleSearch()}
            disabled={isSearching || !selectedProfileId}
            className="flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {isSearching ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Searching...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                Find Buyers
              </>
            )}
          </button>
        </div>
      </div>

      {/* Selected profile titles */}
      {selectedProfile && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-zinc-400">Searching for:</span>
          {selectedProfile.titles.map((t, i) => (
            <span key={i} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">{t}</span>
          ))}
        </div>
      )}

      {/* Error */}
      {searchError && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3">
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
        <div className="mt-6">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {buyers.length} {buyers.length === 1 ? "buyer" : "buyers"} found
          </h3>

          {buyers.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-[13px] text-zinc-500">No buyers found matching this profile at this company</p>
            </div>
          ) : (
            <div className="space-y-1">
              {buyers.map((person) => {
                const isAdded = addedSlugs.has(person.primary_slug);
                const isAdding = addingSlug === person.primary_slug;
                return (
                  <div
                    key={person.primary_slug}
                    className="flex items-center gap-3 rounded-lg border border-zinc-100 px-4 py-3 transition-colors hover:bg-zinc-50"
                  >
                    {/* Photo */}
                    {person.profile_pic ? (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-100">
                        <img src={person.profile_pic} alt={person.name} className="h-9 w-9 rounded-full object-cover" />
                      </div>
                    ) : (
                      <LetterAvatar name={person.name ?? person.first_name ?? "?"} size="sm" />
                    )}

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-zinc-900">{person.name}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-zinc-500">
                        {person.current_job?.title && <span>{person.current_job.title}</span>}
                        {person.headline && !person.current_job?.title && <span>{person.headline}</span>}
                        {person.locality && (
                          <span className="flex items-center gap-1">
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                            {person.locality}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Add button */}
                    {isAdded ? (
                      <span className="flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-1.5 text-[12px] font-medium text-emerald-700">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        Added
                      </span>
                    ) : (
                      <button
                        onClick={() => handleAddPerson(person)}
                        disabled={isAdding}
                        className="flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-[12px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-60"
                      >
                        {isAdding ? (
                          <>
                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
                            Adding...
                          </>
                        ) : (
                          <>
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                            </svg>
                            Add
                          </>
                        )}
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
                className="rounded-lg border border-zinc-200 px-4 py-2 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-60"
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
/*  Lead Detail Page                                                    */
/* ------------------------------------------------------------------ */

export default function LeadDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const [authToken, setAuthToken] = useState("");
  const [lead, setLead] = useState<LeadRecord | null>(null);
  const [persons, setPersons] = useState<PersonRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [isRemoving, setIsRemoving] = useState(false);

  async function handleRemove() {
    if (!authToken || !id) return;
    setIsRemoving(true);
    try {
      const res = await fetch(`${apiBaseUrl}/leads/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Could not remove lead");
      }
      router.replace("/dashboard/leads");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove lead");
      setIsRemoving(false);
    }
  }

  useEffect(() => {
    const storedToken = window.localStorage.getItem(localStorageTokenKey);
    if (!storedToken) { router.replace("/"); return; }
    setAuthToken(storedToken);
  }, [router]);

  useEffect(() => {
    if (!authToken || !id) return;

    Promise.all([
      fetch(`${apiBaseUrl}/leads/${id}`, { headers: { Authorization: `Bearer ${authToken}` } }),
      fetch(`${apiBaseUrl}/leads/${id}/persons`, { headers: { Authorization: `Bearer ${authToken}` } }),
    ])
      .then(async ([leadRes, personsRes]) => {
        if (!leadRes.ok) throw new Error("Lead not found");
        const leadData = (await leadRes.json()) as { lead: LeadRecord };
        setLead(leadData.lead);

        if (personsRes.ok) {
          const personsData = (await personsRes.json()) as { persons: PersonRecord[] };
          setPersons(personsData.persons ?? []);
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load lead");
      })
      .finally(() => setIsLoading(false));
  }, [apiBaseUrl, authToken, id]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
      </div>
    );
  }

  if (error || !lead) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-zinc-500">{error || "Lead not found"}</p>
        <button onClick={() => router.back()} className="text-sm text-zinc-600 underline hover:text-zinc-900">Go back</button>
      </div>
    );
  }

  const data = getFiberData(lead);
  const name = (data?.preferred_name ?? lead.domain) as string;
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
  ];

  return (
    <div className="h-full overflow-y-auto">
      {/* Top bar */}
      <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur-sm">
        <div className="flex items-center gap-3 px-6 py-3">
          <button onClick={() => router.back()} className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <span className="flex-1 text-sm text-zinc-500">Back to Leads</span>
          <button
            onClick={handleRemove}
            disabled={isRemoving}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-[12px] font-medium text-zinc-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            {isRemoving ? "Removing..." : "Remove"}
          </button>
        </div>
        {/* Tabs */}
        <div className="flex gap-0 px-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`relative px-4 py-2.5 text-[13px] font-medium transition-colors ${
                activeTab === tab.key
                  ? "text-zinc-900"
                  : "text-zinc-400 hover:text-zinc-600"
              }`}
            >
              {tab.label}
              {activeTab === tab.key && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-zinc-900 rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-8">
        {/* Header (always visible) */}
        <div className="flex items-start gap-5">
          {logoUrl ? (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-zinc-100">
              <img src={logoUrl} alt={name} className="h-16 w-16 rounded-xl object-cover" />
            </div>
          ) : (
            <LetterAvatar name={name} size="lg" rounded="lg" />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold text-zinc-900">{name}</h1>
            {headline && <p className="mt-1 text-sm text-zinc-500">{headline}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {website && (
                <a href={`https://${website}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-200">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" /><path strokeLinecap="round" strokeLinejoin="round" d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101" /></svg>
                  {website}
                </a>
              )}
              {linkedinSlug && (
                <a href={`https://linkedin.com/company/${linkedinSlug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-200">LinkedIn</a>
              )}
              {twitterHandle && (
                <a href={`https://x.com/${twitterHandle}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-200">@{twitterHandle}</a>
              )}
              {location && (
                <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  {location}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === "overview" ? (
          <div>
            {/* Description */}
            {description && (
              <div className="mt-6 rounded-xl border border-zinc-100 bg-zinc-50/50 px-5 py-4">
                <p className="text-sm leading-relaxed text-zinc-600">{description}</p>
              </div>
            )}

            {/* Key Metrics */}
            {statItems.length > 0 && (
              <div className="mt-6">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Key Metrics</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {statItems.map((stat) => (
                    <div key={stat.label} className="rounded-xl border border-zinc-100 bg-white px-4 py-3">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{stat.label}</p>
                      <p className="mt-1 text-sm font-semibold capitalize text-zinc-800">{stat.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Funding Rounds */}
            {fundingRounds && fundingRounds.length > 0 && (
              <div className="mt-6">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Funding Rounds</h2>
                <div className="space-y-2">
                  {fundingRounds.map((round, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg border border-zinc-100 px-4 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-zinc-800">{formatRoundType(round.round_type)}</span>
                        <span className="text-zinc-400">{new Date(round.round_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
                      </div>
                      <div className="flex items-center gap-3 text-right">
                        {round.round_raised_usd != null && <span className="text-zinc-700">{formatCurrency(round.round_raised_usd)}</span>}
                        {round.round_valuation_usd != null && <span className="text-xs text-zinc-400">@ {formatCurrency(round.round_valuation_usd)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top Investors */}
            {topInvestors && topInvestors.length > 0 && (
              <div className="mt-6">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Key Investors</h2>
                <div className="flex flex-wrap gap-1.5">
                  {topInvestors.map((inv) => (
                    <span key={inv.investor_name} className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">{inv.investor_name}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Acquisitions */}
            {acquisitions && acquisitions.length > 0 && (
              <div className="mt-6">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Acquisitions</h2>
                <div className="space-y-2">
                  {acquisitions.map((acq, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg border border-zinc-100 px-4 py-3 text-sm">
                      <span className="font-medium text-zinc-800">{acq.acquiree_name}</span>
                      <div className="flex items-center gap-2">
                        {acq.price_usd != null && <span className="text-zinc-700">{formatCurrency(acq.price_usd)}</span>}
                        <span className="text-xs text-zinc-400">{new Date(acq.acquisition_date).getFullYear()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* People at this company */}
            {persons.length > 0 && (
              <div className="mt-8">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
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
                        className="flex items-center gap-3 rounded-lg border border-zinc-100 px-4 py-3 transition-colors hover:bg-zinc-50"
                      >
                        {photoUrl ? (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-100">
                            <img src={photoUrl} alt={pName} className="h-8 w-8 rounded-full object-cover" />
                          </div>
                        ) : (
                          <LetterAvatar name={pName} size="xs" />
                        )}
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-medium text-zinc-900">{pName}</span>
                          {title && <span className="ml-2 text-xs text-zinc-500">{title}</span>}
                        </div>
                        <svg className="h-4 w-4 shrink-0 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-6">
            <BuyersTab leadId={id} apiBaseUrl={apiBaseUrl} authToken={authToken} />
          </div>
        )}

        <div className="h-8" />
      </div>
    </div>
  );
}
