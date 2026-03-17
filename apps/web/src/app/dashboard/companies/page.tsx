"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LetterAvatar, DATA_CHANGED_EVENT, safeJson } from "../components";

interface CompanyRecord {
  _id?: string;
  userEmails: string[];
  domain: string;
  createdAt: string;
  enrichedAt?: string;
  enrichmentStatus: "pending" | "completed" | "failed";
  enrichmentData?: Record<string, unknown>;
  enrichmentError?: string;
  atsDetected?: boolean;
  atsName?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getFiberData(company: CompanyRecord): Record<string, any> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = company.enrichmentData as any;
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

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

/* ------------------------------------------------------------------ */
/*  Company Row                                                        */
/* ------------------------------------------------------------------ */

interface SkillRecord {
  _id: string;
  skillType: string;
  enabled: boolean;
}

function CompanyRow({
  company,
  onRemove,
  onATSClick,
  atsInfo,
  enabledSkills,
}: {
  company: CompanyRecord;
  onRemove: (id: string) => void;
  onATSClick: (id: string) => void;
  atsInfo?: { detectionStatus?: string; atsName?: string };
  enabledSkills: SkillRecord[];
}) {
  const [showMenu, setShowMenu] = useState(false);
  const data = getFiberData(company);
  const name = data?.preferred_name ?? company.domain;
  const logoUrl = data?.logo_url as string | undefined;
  const industry = (data?.standard_industries as string[] | undefined)?.[0];
  const location = data?.location_consensus?.formatted_address as string | undefined;
  const employees = data?.employee_count_consensus?.gte as number | undefined;
  const totalFunding = data?.total_funding_consensus as number | undefined;
  const status = company.enrichmentStatus;
  const hasATS = atsInfo?.detectionStatus === "completed" && atsInfo?.atsName;
  const hasDetectATS = enabledSkills.some((s) => s.skillType === "detect_ats");

  return (
    <li>
    <Link
      href={`/dashboard/companies/${company._id}`}
      className="group flex cursor-pointer items-center gap-4 border-b border-zinc-100 px-5 py-3.5 transition-colors hover:bg-zinc-50"
    >
      {/* Logo */}
      <LetterAvatar name={name} size="sm" rounded="lg" src={logoUrl} />

      {/* Name & meta */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-zinc-900">{name}</span>
          <span className="shrink-0 text-[11px] text-zinc-400">{company.domain}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
          {industry && <span>{industry}</span>}
          {location && (
            <span className="flex items-center gap-1">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              {location}
            </span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="hidden items-center gap-6 text-right sm:flex">
        {employees != null && (
          <div>
            <p className="text-[11px] text-zinc-400">Employees</p>
            <p className="text-[13px] font-medium text-zinc-700">{formatNumber(employees)}</p>
          </div>
        )}
        {totalFunding != null && (
          <div>
            <p className="text-[11px] text-zinc-400">Funding</p>
            <p className="text-[13px] font-medium text-zinc-700">{formatCurrency(totalFunding)}</p>
          </div>
        )}
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

      {/* ATS badge (if detected) */}
      {hasATS && (
        <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 flex items-center gap-1">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          {atsInfo?.atsName}
        </span>
      )}

      {/* 3-dot menu for skills */}
      {enabledSkills.length > 0 && (
        <div className="relative">
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowMenu((v) => !v);
            }}
            className="shrink-0 rounded-lg p-1.5 text-zinc-300 opacity-0 transition-all hover:bg-zinc-100 hover:text-zinc-600 group-hover:opacity-100"
            title="Run skill"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
            </svg>
          </button>

          {showMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowMenu(false); }} />
              <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
                {hasDetectATS && !hasATS && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowMenu(false);
                      if (company._id) onATSClick(company._id);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
                  >
                    <svg className="h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    Detect ATS
                  </button>
                )}
                {hasDetectATS && hasATS && (
                  <div className="px-3 py-2 text-[12px] text-zinc-400">
                    ATS already detected
                  </div>
                )}
                {!hasDetectATS && enabledSkills.length === 0 && (
                  <div className="px-3 py-2 text-[12px] text-zinc-400">
                    No skills available
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Remove button */}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (company._id) onRemove(company._id);
        }}
        className="shrink-0 rounded-lg p-1.5 text-zinc-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
        title="Remove from my companies"
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
/*  Dashboard Page                                                     */
/* ------------------------------------------------------------------ */

export default function DashboardPage() {
  const router = useRouter();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const [authToken, setAuthToken] = useState("");
  const [message, setMessage] = useState("");
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [atsData, setATSData] = useState<Record<string, { detectionStatus?: string; atsName?: string }>>({});
  const [enabledSkills, setEnabledSkills] = useState<SkillRecord[]>([]);

  useEffect(() => {
    const storedToken = window.localStorage.getItem(localStorageTokenKey);
    if (!storedToken) {
      router.replace("/");
      return;
    }
    setAuthToken(storedToken);
  }, [router]);

  // Fetch enabled skills
  useEffect(() => {
    if (!authToken) return;
    void fetch(`${apiBaseUrl}/skills`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(async (res) => {
        const data = (await safeJson(res)) as { skills?: SkillRecord[] };
        setEnabledSkills((data.skills ?? []).filter((s) => s.enabled));
      })
      .catch(() => {});
  }, [apiBaseUrl, authToken]);

  const fetchCompanies = useCallback(() => {
    if (!authToken) return;
    setIsLoadingList(true);
    void fetch(`${apiBaseUrl}/companies`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(async (response) => {
        const result = (await safeJson(response)) as { companies?: CompanyRecord[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Could not load companies");
        const loadedCompanies = result.companies ?? [];
        setCompanies(loadedCompanies);

        // Load ATS data for each company
        loadedCompanies.forEach((company) => {
          if (company._id) {
            void fetch(`${apiBaseUrl}/companies/${company._id}/ats`, {
              headers: { Authorization: `Bearer ${authToken}` },
            })
              .then(async (res) => {
                const data = (await safeJson(res)) as { ats?: { detectionStatus?: string; atsName?: string } | null };
                if (data.ats && company._id) {
                  setATSData((prev) => ({ ...prev, [company._id!]: data.ats! }));
                }
              })
              .catch(() => {});
          }
        });
      })
      .catch((error: unknown) => {
        const errorMessage =
          error instanceof Error ? error.message : "Could not load companies";
        setMessage(errorMessage);
      })
      .finally(() => setIsLoadingList(false));
  }, [apiBaseUrl, authToken]);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  useEffect(() => {
    const handler = () => fetchCompanies();
    window.addEventListener(DATA_CHANGED_EVENT, handler);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, handler);
  }, [fetchCompanies]);

  async function handleRemoveCompany(id: string) {
    try {
      const res = await fetch(`${apiBaseUrl}/companies/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const data = (await safeJson(res)) as { error?: string };
        throw new Error(data.error ?? "Could not remove company");
      }
      setCompanies((prev) => prev.filter((c) => c._id !== id));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not remove company");
    }
  }

  async function handleDetectATS(id: string) {
    try {
      setATSData((prev) => ({ ...prev, [id]: { detectionStatus: "pending" } }));
      const res = await fetch(`${apiBaseUrl}/companies/${id}/detect-ats`, {
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
      const result = (await safeJson(res)) as { ats?: { detectionStatus?: string; atsName?: string } };
      if (result.ats) {
        setATSData((prev) => ({ ...prev, [id]: result.ats! }));
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not detect ATS");
      setATSData((prev) => ({ ...prev, [id]: { detectionStatus: "failed" } }));
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Page header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">Companies</h1>
          <p className="text-[13px] text-zinc-500">
            {companies.length} {companies.length === 1 ? "company" : "companies"}
          </p>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className="border-b border-zinc-200 bg-zinc-50 px-6 py-2.5">
          <p className="text-[13px] text-zinc-600">{message}</p>
        </div>
      )}

      {/* Companies list */}
      <div className="flex-1 overflow-y-auto">
        {isLoadingList ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
            <p className="mt-3 text-[13px] text-zinc-400">Loading companies...</p>
          </div>
        ) : (
          <ul>
            {companies.map((company) => (
              <CompanyRow
                key={company._id ?? company.domain}
                company={company}
                onRemove={handleRemoveCompany}
                onATSClick={handleDetectATS}
                atsInfo={company._id ? atsData[company._id] : undefined}
                enabledSkills={enabledSkills}
              />
            ))}
            {companies.length === 0 && (
              <li className="flex flex-col items-center justify-center py-20 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100">
                  <svg className="h-6 w-6 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <p className="text-[13px] font-medium text-zinc-600">No companies yet</p>
                <p className="mt-1 text-[12px] text-zinc-400">Use the + button to add a company</p>
              </li>
            )}
          </ul>
        )}
      </div>

    </div>
  );
}
