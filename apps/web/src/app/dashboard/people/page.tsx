"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

/* ------------------------------------------------------------------ */
/*  Person Row                                                         */
/* ------------------------------------------------------------------ */

function getFullName(data: Record<string, any> | null, linkedinUrl: string): string {
  if (data?.name) return data.name as string;
  const parts = [data?.first_name, data?.last_name].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return linkedinUrl.split("/in/")[1]?.replace(/\/$/, "") ?? "Unknown";
}

function getLocation(data: Record<string, any>): string | undefined {
  if (data.locality) return data.locality as string;
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
  const currentJob = data?.current_job as Record<string, any> | undefined;
  const title = currentJob?.title as string | undefined;
  const company = currentJob?.company_name as string | undefined;
  const location = data ? getLocation(data) : undefined;
  const linkedinSlug = person.linkedinUrl.split("/in/")[1]?.replace(/\/$/, "");
  const status = person.enrichmentStatus;

  return (
    <li>
    <Link
      href={`/dashboard/people/${person._id}`}
      className="group flex cursor-pointer items-center gap-4 border-b border-zinc-100 px-5 py-3.5 transition-colors hover:bg-zinc-50"
    >
      {/* Avatar */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-100">
        {photoUrl ? (
          <img src={photoUrl} alt={fullName} className="h-9 w-9 rounded-full object-cover" />
        ) : (
          <span className="text-xs font-semibold text-zinc-400">
            {fullName.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      {/* Name & meta */}
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

      {/* Status badge */}
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
          status === "completed"
            ? "bg-emerald-50 text-emerald-700"
            : status === "failed"
              ? "bg-red-50 text-red-600"
              : "bg-amber-50 text-amber-700"
        }`}
      >
        {status}
      </span>

      {/* Remove button */}
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

      {/* Chevron */}
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

    void fetch(`${apiBaseUrl}/persons`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(async (response) => {
        const result = (await response.json()) as { persons?: PersonRecord[]; error?: string };
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

  async function handleRemovePerson(id: string) {
    try {
      const res = await fetch(`${apiBaseUrl}/persons/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Could not remove person");
      }
      setPersons((prev) => prev.filter((p) => p._id !== id));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not remove person");
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Page header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">People</h1>
          <p className="text-[13px] text-zinc-500">
            {persons.length} {persons.length === 1 ? "person" : "people"}
          </p>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className="border-b border-zinc-200 bg-zinc-50 px-6 py-2.5">
          <p className="text-[13px] text-zinc-600">{message}</p>
        </div>
      )}

      {/* People list */}
      <div className="flex-1 overflow-y-auto">
        {isLoadingList ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
            <p className="mt-3 text-[13px] text-zinc-400">Loading people...</p>
          </div>
        ) : (
          <ul>
            {persons.map((person) => (
              <PersonRow
                key={person._id ?? person.linkedinUrl}
                person={person}
                onRemove={handleRemovePerson}
              />
            ))}
            {persons.length === 0 && (
              <li className="flex flex-col items-center justify-center py-20 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100">
                  <svg className="h-6 w-6 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                </div>
                <p className="text-[13px] font-medium text-zinc-600">No people yet</p>
                <p className="mt-1 text-[12px] text-zinc-400">Use the + button to add a person</p>
              </li>
            )}
          </ul>
        )}
      </div>

    </div>
  );
}
