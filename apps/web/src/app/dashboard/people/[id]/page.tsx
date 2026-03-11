"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";

interface PersonRecord {
  _id?: string;
  userEmails: string[];
  linkedinUrl: string;
  companyDomain?: string;
  createdAt: string;
  enrichedAt?: string;
  enrichmentStatus: "pending" | "completed" | "failed";
  enrichmentData?: Record<string, unknown>;
  enrichmentError?: string;
}

interface LeadRecord {
  _id?: string;
  domain: string;
  enrichmentData?: Record<string, unknown>;
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

const localStorageTokenKey = "gtmbench-token";
function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

export default function PersonDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const [authToken, setAuthToken] = useState("");
  const [person, setPerson] = useState<PersonRecord | null>(null);
  const [companyLead, setCompanyLead] = useState<LeadRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [isRemoving, setIsRemoving] = useState(false);

  async function handleRemove() {
    if (!authToken || !id) return;
    setIsRemoving(true);
    try {
      const res = await fetch(`${apiBaseUrl}/persons/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Could not remove person");
      }
      router.replace("/dashboard/people");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove person");
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

    fetch(`${apiBaseUrl}/persons/${id}`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error("Person not found");
        const data = (await res.json()) as { person: PersonRecord };
        setPerson(data.person);

        // If person has a company domain, fetch the company lead
        if (data.person.companyDomain) {
          try {
            const leadRes = await fetch(`${apiBaseUrl}/leads/by-domain/${data.person.companyDomain}`, {
              headers: { Authorization: `Bearer ${authToken}` },
            });
            if (leadRes.ok) {
              const leadData = (await leadRes.json()) as { lead: LeadRecord };
              setCompanyLead(leadData.lead);
            }
          } catch {
            // Company might not be enriched yet, that's fine
          }
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load person");
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

  if (error || !person) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-zinc-500">{error || "Person not found"}</p>
        <button onClick={() => router.back()} className="text-sm text-zinc-600 underline hover:text-zinc-900">Go back</button>
      </div>
    );
  }

  const data = getFiberData(person);
  const fullName = getFullName(data, person.linkedinUrl);
  const photoUrl = data?.profile_pic as string | undefined;
  const currentJob = data?.current_job as Record<string, any> | undefined;
  const title = currentJob?.title as string | undefined;
  const company = currentJob?.company_name as string | undefined;
  const location = data ? getLocation(data) : undefined;
  const bio = (data?.summary ?? data?.headline) as string | undefined;
  const linkedinSlug = person.linkedinUrl.split("/in/")[1]?.replace(/\/$/, "");
  const seniority = currentJob?.seniority as string | undefined;
  const industry = data?.industry_name as string | undefined;

  const experiences = data?.experiences as {
    title: string;
    company_name: string;
    start_date: string;
    end_date: string | null;
    is_current: boolean | null;
    seniority: string | null;
  }[] | undefined;

  const education = data?.education as {
    school_name: string;
    degree: string | null;
    field_of_study_name: string | null;
    start_date: string | null;
    end_date: string | null;
  }[] | undefined;

  const skills = data?.skills as string[] | undefined;

  const infoItems = [
    { label: "Title", value: title ?? null },
    { label: "Company", value: company ?? null },
    { label: "Seniority", value: seniority ?? null },
    { label: "Industry", value: industry ?? null },
    { label: "Location", value: location ?? null },
    { label: "Connections", value: data?.connection_count ? String(data.connection_count) : null },
  ].filter((s) => s.value != null);

  // Company lead data for the card
  const companyData = companyLead ? getFiberData(companyLead) : null;
  const companyName = companyData?.preferred_name ?? companyLead?.domain;
  const companyLogo = companyData?.logo_url as string | undefined;
  const companyIndustry = (companyData?.standard_industries as string[] | undefined)?.[0];

  return (
    <div className="h-full overflow-y-auto">
      {/* Top bar */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-200 bg-white/80 px-6 py-3 backdrop-blur-sm">
        <button onClick={() => router.back()} className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <span className="flex-1 text-sm text-zinc-500">Back to People</span>
        <button
          onClick={handleRemove}
          disabled={isRemoving}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-[12px] font-medium text-zinc-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          {isRemoving ? "Removing..." : "Remove"}
        </button>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-8">
        {/* Header */}
        <div className="flex items-start gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-100">
            {photoUrl ? (
              <img src={photoUrl} alt={fullName} className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <span className="text-2xl font-bold text-zinc-400">{fullName.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold text-zinc-900">{fullName}</h1>
            {title && company && <p className="mt-1 text-sm text-zinc-500">{title} at {company}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {linkedinSlug && (
                <a href={person.linkedinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-200">LinkedIn</a>
              )}
              {location && (
                <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  {location}
                </span>
              )}
              {data?.open_to_work && (
                <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Open to work</span>
              )}
              {data?.is_hiring && (
                <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">Hiring</span>
              )}
            </div>
          </div>
        </div>

        {/* Company Card */}
        {companyLead && (
          <Link
            href={`/dashboard/leads/${companyLead._id}`}
            className="mt-6 flex items-center gap-4 rounded-xl border border-zinc-200 bg-zinc-50/50 px-5 py-4 transition-colors hover:bg-zinc-100/50"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
              {companyLogo ? (
                <img src={companyLogo} alt={companyName} className="h-10 w-10 rounded-lg object-cover" />
              ) : (
                <span className="text-sm font-bold text-zinc-400">{(companyName as string)?.charAt(0)?.toUpperCase()}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Current Company</p>
              <p className="text-sm font-semibold text-zinc-900">{companyName}</p>
              {companyIndustry && <p className="text-xs text-zinc-500">{companyIndustry}</p>}
            </div>
            <svg className="h-4 w-4 shrink-0 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </Link>
        )}

        {/* Bio */}
        {bio && (
          <div className="mt-6 rounded-xl border border-zinc-100 bg-zinc-50/50 px-5 py-4">
            <p className="text-sm leading-relaxed text-zinc-600">{bio}</p>
          </div>
        )}

        {/* Info Grid */}
        {infoItems.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Details</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {infoItems.map((item) => (
                <div key={item.label} className="rounded-xl border border-zinc-100 bg-white px-4 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{item.label}</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-800">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Experience */}
        {experiences && experiences.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Experience</h2>
            <div className="space-y-2">
              {experiences.slice(0, 5).map((exp, i) => (
                <div key={i} className="flex items-start justify-between rounded-lg border border-zinc-100 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-zinc-800">{exp.title}</span>
                    {exp.company_name && <span className="ml-1 text-zinc-500">at {exp.company_name}</span>}
                    {exp.is_current && <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">Current</span>}
                  </div>
                  <span className="ml-2 shrink-0 text-xs text-zinc-400">
                    {exp.start_date?.slice(0, 4)}{exp.end_date ? ` – ${exp.end_date.slice(0, 4)}` : exp.start_date ? " – Present" : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Education */}
        {education && education.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Education</h2>
            <div className="space-y-2">
              {education.slice(0, 4).map((edu, i) => (
                <div key={i} className="rounded-lg border border-zinc-100 px-4 py-3 text-sm">
                  <span className="font-medium text-zinc-800">{edu.school_name}</span>
                  {(edu.degree || edu.field_of_study_name) && (
                    <span className="ml-1 text-zinc-500">— {[edu.degree, edu.field_of_study_name].filter(Boolean).join(", ")}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Skills */}
        {skills && skills.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Skills</h2>
            <div className="flex flex-wrap gap-1.5">
              {skills.slice(0, 15).map((skill) => (
                <span key={skill} className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">{skill}</span>
              ))}
            </div>
          </div>
        )}

        <div className="h-8" />
      </div>
    </div>
  );
}
