"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LetterAvatar, DATA_CHANGED_EVENT, safeJson, dispatchGlobalAction } from "../components";

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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

/* ------------------------------------------------------------------ */
/*  Skeleton Row                                                       */
/* ------------------------------------------------------------------ */

function SkeletonRow() {
  return (
    <li className="flex items-center gap-4 px-5 py-3.5 border-b border-zinc-100">
      <div className="h-9 w-9 rounded-full animate-shimmer" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-32 rounded animate-shimmer" />
        <div className="h-3 w-44 rounded animate-shimmer" />
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Person Row                                                         */
/* ------------------------------------------------------------------ */

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

function PersonRow({
  person,
  onRemove,
}: {
  person: PersonRecord;
  onRemove: (id: string) => void;
}) {
  const data = getFiberData(person);
  const fullName = getFullName(data, person.linkedinUrl);
  const photoUrl = data?.profile_pic as string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentJob = data?.current_job as Record<string, any> | undefined;
  const title = currentJob?.title as string | undefined;
  const company = currentJob?.company_name as string | undefined;
  const location = data ? getLocation(data) : undefined;
  const linkedinSlug = person.linkedinUrl.split("/in/")[1]?.replace(/\/$/, "");
  const status = person.enrichmentStatus;

  return (
    <li className="animate-fade-in">
    <Link
      href={`/dashboard/people/${person._id}`}
      className="group flex cursor-pointer items-center gap-4 border-b border-zinc-100 px-5 py-3.5 transition-all hover:bg-zinc-50/80"
    >
      <LetterAvatar name={fullName} size="sm" src={photoUrl} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-zinc-900">{fullName}</span>
          {linkedinSlug && (
            <span className="shrink-0 text-[11px] text-zinc-400">/{linkedinSlug}</span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
          {title && <span>{title}</span>}
          {company && (
            <span className="flex items-center gap-1">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
              {company}
            </span>
          )}
          {location && (
            <span className="flex items-center gap-1">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              {location}
            </span>
          )}
        </div>
      </div>

      {status !== "completed" && (
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
            status === "failed" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"
          }`}
        >
          {status}
        </span>
      )}

      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (person._id) onRemove(person._id);
        }}
        className="shrink-0 rounded-lg p-1.5 text-zinc-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
        title="Remove from my people"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
      </button>

      <svg className="h-4 w-4 shrink-0 text-zinc-300 transition-colors group-hover:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
    </Link>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  People Page                                                        */
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
    void fetch(`${apiBaseUrl}/persons`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(async (response) => {
        const result = (await safeJson(response)) as { persons?: PersonRecord[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Could not load people");
        setPersons(result.persons ?? []);
      })
      .catch((error: unknown) => {
        const errorMessage =
          error instanceof Error ? error.message : "Could not load people";
        setMessage(errorMessage);
      })
      .finally(() => setIsLoadingList(false));
  }, [apiBaseUrl, authToken]);

  useEffect(() => {
    fetchPersons();
  }, [fetchPersons]);

  useEffect(() => {
    const handler = () => fetchPersons();
    window.addEventListener(DATA_CHANGED_EVENT, handler);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, handler);
  }, [fetchPersons]);

  async function handleRemovePerson(id: string) {
    try {
      const res = await fetch(`${apiBaseUrl}/persons/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const data = (await safeJson(res)) as { error?: string };
        throw new Error(data.error ?? "Could not remove person");
      }
      setPersons((prev) => prev.filter((p) => p._id !== id));
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
      const title = (currentJob?.title as string | undefined) ?? "";
      const company = (currentJob?.company_name as string | undefined) ?? "";
      return (
        fullName.toLowerCase().includes(q) ||
        p.linkedinUrl.toLowerCase().includes(q) ||
        title.toLowerCase().includes(q) ||
        company.toLowerCase().includes(q)
      );
    });
  }, [persons, searchQuery]);

  return (
    <div className="flex h-full flex-col bg-white">

      <div className="border-b border-zinc-100 px-5 py-2.5 flex items-center gap-2">
        {persons.length > 0 && (
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search people..."
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2 pl-9 pr-3 text-[13px] placeholder:text-zinc-400 focus:border-[#5469d4] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#5469d4]/10 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-600"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}
        <button
          onClick={() => dispatchGlobalAction("person")}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[13px] font-medium text-zinc-700 transition-all hover:bg-zinc-50 active:scale-[0.97]"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add person
        </button>
      </div>

      {message && (
        <div className="border-b border-zinc-200 bg-red-50 px-6 py-2.5">
          <p className="text-[13px] text-red-600">{message}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-xl">
        {isLoadingList ? (
          <ul>
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </ul>
        ) : (
          <ul>
            {filteredPersons.map((person) => (
              <PersonRow
                key={person._id ?? person.linkedinUrl}
                person={person}
                onRemove={handleRemovePerson}
              />
            ))}
            {filteredPersons.length === 0 && persons.length > 0 && (
              <li className="flex items-center justify-center py-16">
                <p className="text-[14px] text-black/40">No results for &ldquo;{searchQuery}&rdquo;</p>
              </li>
            )}
            {persons.length === 0 && (
              <li className="flex items-center justify-center" style={{ height: "calc(100vh - 120px)" }}>
                <p className="text-[14px] text-black/40">No people yet</p>
              </li>
            )}
          </ul>
        )}
        </div>
      </div>

    </div>
  );
}
