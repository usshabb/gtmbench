"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LetterAvatar, safeJson, apiFetch } from "../components";

const STAGES = ["Lead", "Interested", "Demo", "Onboarding", "Live", "Later"];

interface PipelineCompany {
  _id: string;
  domain: string;
  starred: boolean;
  pipelineStage: string | null;
  enrichmentData?: Record<string, unknown>;
  buyerProfile?: { _id: string; name: string; price?: number | null } | null;
  persons?: { name: string; title?: string; profilePic?: string | null }[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getFiberData(company: PipelineCompany): Record<string, any> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = company.enrichmentData as any;
    return raw?.output?.data?.[0] ?? null;
  } catch {
    return null;
  }
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

const localStorageTokenKey = "gtmbench-token";
function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

/* ------------------------------------------------------------------ */
/*  Company Card                                                        */
/* ------------------------------------------------------------------ */

function PipelineCard({
  company,
  onDragStart,
}: {
  company: PipelineCompany;
  onDragStart: (e: React.DragEvent, companyId: string) => void;
}) {
  const data = getFiberData(company);
  const name = (data?.preferred_name ?? company.domain) as string;
  const logoUrl = data?.logo_url as string | undefined;
  const industry = (data?.standard_industries as string[] | undefined)?.[0];
  const employees = data?.employee_count_consensus?.gte as number | undefined;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, company._id)}
      className="group cursor-grab rounded-lg border border-[#e6e6e9] bg-white p-3 shadow-sm transition-all hover:shadow-md hover:border-[#d4d4d8] active:cursor-grabbing active:shadow-lg"
    >
      <Link href={`/dashboard/companies/${company._id}`} className="block">
        <div className="flex items-center gap-2.5">
          <LetterAvatar name={name} size="sm" rounded="lg" src={logoUrl} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-[#1b1b1f]">{name}</p>
            <p className="truncate text-[11px] text-[#8b8d94]">{company.domain}</p>
          </div>
        </div>

        {/* Info pills */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {company.buyerProfile && (
            <span className="rounded-full bg-[#f0f0ff] px-2 py-0.5 text-[10px] font-medium text-indigo-600">
              {company.buyerProfile.name}
            </span>
          )}
          {industry && (
            <span className="rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[10px] font-medium text-[#6b6f76]">
              {industry}
            </span>
          )}
          {employees != null && (
            <span className="rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[10px] font-medium text-[#6b6f76]">
              {employees.toLocaleString()} people
            </span>
          )}
        </div>

        {/* Persons preview */}
        {company.persons && company.persons.length > 0 && (
          <div className="mt-2.5 flex items-center gap-1">
            <div className="flex -space-x-1.5">
              {company.persons.slice(0, 3).map((p, i) => (
                <div key={i} className="relative">
                  <LetterAvatar name={p.name} size="xs" src={p.profilePic} />
                </div>
              ))}
            </div>
            <span className="ml-1 text-[10px] text-[#8b8d94]">
              {company.persons.length} {company.persons.length === 1 ? "contact" : "contacts"}
            </span>
          </div>
        )}

        {/* Price tag */}
        {company.buyerProfile?.price != null && company.buyerProfile.price > 0 && (
          <div className="mt-2 text-right">
            <span className="text-[12px] font-semibold text-emerald-600">
              {formatCurrency(company.buyerProfile.price)}
            </span>
          </div>
        )}
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pipeline Column                                                      */
/* ------------------------------------------------------------------ */

function PipelineColumn({
  stage,
  companies,
  totalValue,
  onDragStart,
  onDragOver,
  onDrop,
  isDragOver,
}: {
  stage: string;
  companies: PipelineCompany[];
  totalValue: number;
  onDragStart: (e: React.DragEvent, companyId: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, stage: string) => void;
  isDragOver: boolean;
}) {
  return (
    <div
      className={`flex w-72 shrink-0 flex-col rounded-lg transition-colors ${
        isDragOver ? "bg-indigo-50/50" : "bg-[#f5f5f7]"
      }`}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, stage)}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-[#1b1b1f]">{stage}</h3>
          <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#e6e6e9] px-1.5 text-[11px] font-medium text-[#6b6f76]">
            {companies.length}
          </span>
        </div>
      </div>

      {/* Cards */}
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2" style={{ maxHeight: "calc(100vh - 220px)" }}>
        {companies.map((company) => (
          <PipelineCard key={company._id} company={company} onDragStart={onDragStart} />
        ))}
        {companies.length === 0 && (
          <div className={`flex h-24 items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
            isDragOver ? "border-indigo-300 bg-indigo-50/30" : "border-[#e6e6e9]"
          }`}>
            <p className="text-[12px] text-[#8b8d94]">Drop here</p>
          </div>
        )}
      </div>

      {/* Column footer — value */}
      {totalValue > 0 && (
        <div className="border-t border-[#e6e6e9] px-3 py-2">
          <p className="text-[11px] text-[#8b8d94]">
            Value: <span className="font-semibold text-emerald-600">{formatCurrency(totalValue)}</span>
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                                 */
/* ------------------------------------------------------------------ */

export default function PipelinePage() {
  const router = useRouter();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const [authToken, setAuthToken] = useState("");
  const [companies, setCompanies] = useState<PipelineCompany[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    const storedToken = window.localStorage.getItem(localStorageTokenKey);
    if (!storedToken) { router.replace("/"); return; }
    void (async () => { setAuthToken(storedToken); })();
  }, [router]);

  const fetchPipeline = useCallback(() => {
    if (!authToken) return;
    void apiFetch(`${apiBaseUrl}/pipeline`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load pipeline");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (await safeJson(res)) as { companies?: any[]; profiles?: any[]; persons?: any[] };
        const rawCompanies = data.companies ?? [];
        const profiles = data.profiles ?? [];
        const persons = data.persons ?? [];

        // Build profile map
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const profileMap = new Map<string, any>();
        for (const p of profiles) profileMap.set(String(p._id), p);

        // Build person map by companyId
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const personsByCompany = new Map<string, any[]>();
        for (const p of persons) {
          const cid = p.companyId ? String(p.companyId) : null;
          if (!cid) continue;
          if (!personsByCompany.has(cid)) personsByCompany.set(cid, []);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pData = (p.enrichmentData as any)?.output?.data?.[0];
          personsByCompany.get(cid)!.push({
            name: pData?.name ?? pData?.first_name ?? p.linkedinUrl?.split("/in/")?.[1] ?? "Unknown",
            title: pData?.current_job?.title,
            profilePic: pData?.profile_pic ?? null,
          });
        }

        // Join
        const enriched: PipelineCompany[] = rawCompanies.map((c) => {
          const cid = String(c._id);
          const profileId = c.buyerProfileId ? String(c.buyerProfileId) : null;
          const profile = profileId ? profileMap.get(profileId) : null;
          return {
            _id: cid,
            domain: c.domain,
            starred: c.starred ?? false,
            pipelineStage: c.pipelineStage ?? null,
            enrichmentData: c.enrichmentData,
            buyerProfile: profile ? { _id: String(profile._id), name: profile.name, price: profile.price ?? null } : null,
            persons: personsByCompany.get(cid) ?? [],
          };
        });

        setCompanies(enriched);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load pipeline");
      })
      .finally(() => setIsLoading(false));
  }, [apiBaseUrl, authToken]);

  useEffect(() => { fetchPipeline(); }, [fetchPipeline]);

  // Group companies by stage
  const stageMap = useMemo(() => {
    const map: Record<string, PipelineCompany[]> = {};
    for (const stage of STAGES) map[stage] = [];
    for (const company of companies) {
      const stage = company.pipelineStage ?? "Lead";
      if (map[stage]) {
        map[stage].push(company);
      } else {
        map["Lead"].push(company);
      }
    }
    return map;
  }, [companies]);

  // Calculate total value per stage
  const stageValues = useMemo(() => {
    const values: Record<string, number> = {};
    for (const stage of STAGES) {
      values[stage] = stageMap[stage].reduce((sum, c) => sum + (c.buyerProfile?.price ?? 0), 0);
    }
    return values;
  }, [stageMap]);

  // Total pipeline value
  const totalPipelineValue = useMemo(() => {
    return companies.reduce((sum, c) => sum + (c.buyerProfile?.price ?? 0), 0);
  }, [companies]);

  function handleDragStart(e: React.DragEvent, companyId: string) {
    e.dataTransfer.setData("text/plain", companyId);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(companyId);
  }

  function handleDragOver(e: React.DragEvent, stage: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStage(stage);
  }

  async function handleDrop(e: React.DragEvent, stage: string) {
    e.preventDefault();
    setDragOverStage(null);
    setDraggingId(null);

    const companyId = e.dataTransfer.getData("text/plain");
    if (!companyId) return;

    const company = companies.find((c) => c._id === companyId);
    if (!company || company.pipelineStage === stage) return;

    // Optimistic update
    setCompanies((prev) =>
      prev.map((c) => (c._id === companyId ? { ...c, pipelineStage: stage } : c))
    );

    try {
      const res = await apiFetch(`${apiBaseUrl}/companies/${companyId}/pipeline-stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ stage }),
      });
      if (!res.ok) {
        // Revert on error
        setCompanies((prev) =>
          prev.map((c) => (c._id === companyId ? { ...c, pipelineStage: company.pipelineStage } : c))
        );
      }
    } catch {
      // Revert on error
      setCompanies((prev) =>
        prev.map((c) => (c._id === companyId ? { ...c, pipelineStage: company.pipelineStage } : c))
      );
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#d4d4d8] border-t-[#6b6f76]" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white">
      {error && (
        <div className="bg-red-50 px-6 py-2.5">
          <p className="text-[13px] text-red-600">{error}</p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#e6e6e9] px-6 py-4">
        <div>
          <h1 className="text-[16px] font-semibold text-[#1b1b1f]">Pipeline</h1>
          <p className="mt-0.5 text-[12px] text-[#8b8d94]">
            {companies.length} {companies.length === 1 ? "company" : "companies"} in pipeline
          </p>
        </div>
        {totalPipelineValue > 0 && (
          <div className="text-right">
            <p className="text-[11px] text-[#8b8d94]">Total pipeline value</p>
            <p className="text-[18px] font-bold text-emerald-600">{formatCurrency(totalPipelineValue)}</p>
          </div>
        )}
      </div>

      {/* Kanban board */}
      {companies.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#f5f5f7]">
            <svg className="h-7 w-7 text-[#8b8d94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </div>
          <p className="text-[14px] font-medium text-[#6b6f76]">No companies in pipeline</p>
          <p className="text-[12px] text-[#8b8d94]">Star a company to add it to your pipeline</p>
          <Link
            href="/dashboard/companies"
            className="mt-2 rounded-lg bg-[#1b1b1f] px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
          >
            Go to Companies
          </Link>
        </div>
      ) : (
        <div
          className="flex flex-1 gap-3 overflow-x-auto p-4"
          onDragLeave={() => setDragOverStage(null)}
        >
          {STAGES.map((stage) => (
            <PipelineColumn
              key={stage}
              stage={stage}
              companies={stageMap[stage]}
              totalValue={stageValues[stage]}
              onDragStart={handleDragStart}
              onDragOver={(e) => handleDragOver(e, stage)}
              onDrop={handleDrop}
              isDragOver={dragOverStage === stage}
            />
          ))}
        </div>
      )}
    </div>
  );
}
