"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LetterAvatar, DATA_CHANGED_EVENT, safeJson, dispatchGlobalAction, dispatchDataChanged, apiFetch } from "../components";

interface PersonRecord {
  _id?: string;
  userEmails: string[];
  linkedinUrl: string;
  createdAt: string;
  enrichedAt?: string;
  enrichmentStatus: "pending" | "completed" | "failed";
  enrichmentData?: Record<string, unknown>;
  enrichmentError?: string;
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
}: {
  person: PersonRecord;
  onRemove: (id: string) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);

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
        </div>
      </div>

      {/* 3-dot menu */}
      <div className="relative z-10">
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowMenu((v) => !v); }}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[#8b8d94] transition-all hover:bg-[#ededf0] hover:text-[#6b6f76]"
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
        </button>
        {showMenu && (
          <>
            <div className="fixed inset-0 z-20" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowMenu(false); }} />
            <div className="absolute right-0 top-8 z-30 w-36 rounded-md border border-[#e6e6e9] bg-white py-1 shadow-sm">
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

  useEffect(() => {
    const storedToken = window.localStorage.getItem(localStorageTokenKey);
    if (!storedToken) {
      router.replace("/");
      return;
    }
    setAuthToken(storedToken);
  }, [router]);

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
