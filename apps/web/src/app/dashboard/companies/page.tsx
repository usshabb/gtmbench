"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LetterAvatar, DATA_CHANGED_EVENT, safeJson, dispatchGlobalAction, dispatchDataChanged, apiFetch } from "../components";

interface CompanyRecord {
  _id?: string;
  userEmails: string[];
  domain: string;
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

interface SkillRecord {
  _id: string;
  skillType: string;
  enabled: boolean;
}

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
  if (value == null) return "";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return "";
  return value.toLocaleString();
}

const localStorageTokenKey = "gtmbench-token";
function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

/* ------------------------------------------------------------------ */
/*  Skills Modal                                                        */
/* ------------------------------------------------------------------ */

function SkillsModal({
  companyId,
  companyName,
  enabledSkills,
  atsInfo,
  onClose,
  onDetectATS,
  isDetectingATS,
}: {
  companyId: string;
  companyName: string;
  enabledSkills: SkillRecord[];
  atsInfo?: { detectionStatus?: string; atsName?: string | null; careerPageUrl?: string | null };
  onClose: () => void;
  onDetectATS: (id: string) => void;
  isDetectingATS: string | null;
}) {
  const hasDetectATS = enabledSkills.some((s) => s.skillType === "detect_ats");
  const hasATS = atsInfo?.detectionStatus === "completed" && atsInfo?.atsName;
  const isRunning = isDetectingATS === companyId;

  return (
    <div
      className="fixed inset-0 z-[500] flex items-start justify-center bg-black/30 p-4 pt-[18vh] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div className="w-full max-w-sm rounded-lg bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <h2 className="text-[16px] font-medium text-[#1b1b1f]">Run a Skill</h2>
            <p className="mt-0.5 text-[12px] text-[#8b8d94]">{companyName}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-[#8b8d94] hover:bg-[#ededf0] transition-colors">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-5 pb-5 space-y-2">
          {hasDetectATS && (
            hasATS ? (
              <div className="flex items-center gap-3 rounded-lg border border-[#ededf0] bg-[#f9f9fb] px-3.5 py-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50">
                  <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <div>
                  <p className="text-[13px] font-medium text-[#6b6f76]">ATS Detected</p>
                  <p className="text-[11px] text-[#8b8d94]">{atsInfo?.atsName}</p>
                </div>
              </div>
            ) : (
              <button
                onClick={() => { onDetectATS(companyId); onClose(); }}
                disabled={isRunning}
                className="flex w-full items-center gap-3 rounded-lg border border-[#e6e6e9] px-3.5 py-2.5 text-left transition-colors hover:bg-[#f5f5f7] disabled:opacity-60"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f5f5f7]">
                  <svg className="h-4 w-4 text-[#6b6f76]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <p className="text-[13px] font-medium text-[#1b1b1f]">{isRunning ? "Detecting…" : "Detect ATS"}</p>
                  <p className="text-[11px] text-[#8b8d94]">Find this company's hiring system</p>
                </div>
              </button>
            )
          )}
          {enabledSkills.length === 0 && (
            <p className="py-4 text-center text-[13px] text-[#8b8d94]">No skills enabled. Enable skills in the Skills page.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Change Buyer Profile Modal                                          */
/* ------------------------------------------------------------------ */

function ChangeBuyerProfileModal({
  entityName,
  currentProfileId,
  allProfiles,
  isCompany,
  onClose,
  onConfirm,
}: {
  entityName: string;
  currentProfileId: string | null;
  allProfiles: BuyerProfile[];
  isCompany: boolean;
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

        {isCompany && (
          <p className="mx-5 mt-2 rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
            This will update the buyer profile for all people linked to this company.
          </p>
        )}

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

/* ------------------------------------------------------------------ */
/*  Delete Company Modal                                               */
/* ------------------------------------------------------------------ */

function DeleteCompanyModal({
  companyId,
  companyName,
  apiBaseUrl,
  authToken,
  onClose,
  onConfirm,
}: {
  companyId: string;
  companyName: string;
  apiBaseUrl: string;
  authToken: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [persons, setPersons] = useState<{ _id: string; name: string; title?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    apiFetch(`${apiBaseUrl}/companies/${companyId}/persons`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((r) => r.json())
      .then((data: unknown) => {
        const arr = Array.isArray(data) ? data : [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setPersons(arr.map((p: any) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fiber = (p.enrichmentData as any)?.output?.data?.[0] ?? null;
          const name = fiber?.preferred_name ?? fiber?.full_name ?? p.linkedinUrl ?? "Unknown";
          const title = fiber?.current_job?.title as string | undefined;
          return { _id: p._id, name, title };
        }));
      })
      .catch(() => setPersons([]))
      .finally(() => setLoading(false));
  }, [companyId, apiBaseUrl, authToken]);

  async function handleConfirm() {
    setConfirming(true);
    try {
      await onConfirm();
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[500] flex items-start justify-center bg-black/30 p-4 pt-[18vh] backdrop-blur-[2px]" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <h2 className="text-[15px] font-semibold text-[#1b1b1f]">Delete Company</h2>
            <p className="mt-0.5 text-[12px] text-[#8b8d94] truncate max-w-[220px]">{companyName}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-[#8b8d94] hover:bg-[#ededf0] transition-colors">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-5 pb-4">
          {loading ? (
            <div className="space-y-2 py-1">
              {[1, 2].map((i) => <div key={i} className="h-9 rounded-md bg-[#f5f5f7] animate-pulse" />)}
            </div>
          ) : persons.length > 0 ? (
            <>
              <p className="mb-2 text-[12px] text-[#8b8d94]">
                This will also delete {persons.length} linked {persons.length === 1 ? "person" : "people"}:
              </p>
              <div className="max-h-48 overflow-y-auto space-y-1.5">
                {persons.map((p) => (
                  <div key={p._id} className="flex items-center gap-2.5 rounded-md border border-[#e6e6e9] bg-[#f9f9fb] px-3 py-2">
                    <svg className="h-3.5 w-3.5 shrink-0 text-[#8b8d94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-[#1b1b1f]">{p.name}</p>
                      {p.title && <p className="truncate text-[11px] text-[#8b8d94]">{p.title}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[12px] text-[#8b8d94]">No linked people will be affected.</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 pb-4">
          <button onClick={onClose} className="rounded-md border border-[#e6e6e9] px-3 py-1.5 text-[13px] font-medium text-[#6b6f76] hover:bg-[#f5f5f7] transition-colors">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirming || loading}
            className="rounded-md bg-red-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {confirming ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Company Card                                                        */
/* ------------------------------------------------------------------ */

function CompanyCard({
  company,
  onRemove,
  onDetectATS,
  atsInfo,
  enabledSkills,
  isDetectingATS,
  buyerProfile,
  allBuyerProfiles,
  onBuyerProfileUpdated,
  apiBaseUrl,
  authToken,
  trackedPersonCount,
}: {
  company: CompanyRecord;
  onRemove: (id: string) => Promise<void>;
  onDetectATS: (id: string) => void;
  atsInfo?: { detectionStatus?: string; atsName?: string | null; careerPageUrl?: string | null };
  enabledSkills: SkillRecord[];
  isDetectingATS: string | null;
  buyerProfile?: BuyerProfile;
  allBuyerProfiles: BuyerProfile[];
  onBuyerProfileUpdated: (companyId: string, buyerProfileId: string | null) => void;
  apiBaseUrl: string;
  authToken: string;
  trackedPersonCount: number | null;
}) {
  const [showSkillsModal, setShowSkillsModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showBuyerProfileModal, setShowBuyerProfileModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const data = getFiberData(company);
  const name = (data?.preferred_name ?? company.domain) as string;
  const logoUrl = data?.logo_url as string | undefined;
  const industry = (data?.standard_industries as string[] | undefined)?.[0];
  const location = data?.location_consensus?.formatted_address as string | undefined;
  const employees = data?.employee_count_consensus?.gte as number | undefined;
  const totalFunding = data?.total_funding_consensus as number | undefined;
  const hasATS = atsInfo?.detectionStatus === "completed" && atsInfo?.atsName;
  const skillCount = hasATS ? 1 : 0;
  const websiteUrl = company.domain.startsWith("http") ? company.domain : `https://${company.domain}`;

  const employeesStr = employees != null ? formatNumber(employees) : null;
  const fundingStr = totalFunding != null ? formatCurrency(totalFunding) : null;

  return (
    <>
      <div className="group relative flex items-center gap-3 rounded-lg border border-[#e6e6e9] bg-white px-3.5 py-2.5 transition-all hover:border-[#d4d4d8]">
        <Link href={`/dashboard/companies/${company._id}`} className="absolute inset-0 rounded-lg" />

        {/* Logo */}
        <div className="relative shrink-0">
          <LetterAvatar name={name} size="md" rounded="lg" src={logoUrl} />
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="relative z-10 text-[14px] font-medium text-[#1b1b1f] hover:underline"
            >
              {name}
            </a>
          </div>
        </div>

        {/* Pills */}
        <div className="relative z-[100] hidden items-center gap-2 sm:flex">
          {buyerProfile && (
            <span className="rounded-full border border-[#e6e6e9] bg-[#f5f5f7] px-2.5 py-0.5 text-[12px] font-medium text-[#6b6f76]">
              {buyerProfile.name}
            </span>
          )}
          {(employeesStr || (trackedPersonCount !== null && trackedPersonCount > 0)) && (
            <span className="rounded-md border border-[#e6e6e9] bg-[#f5f5f7] px-2.5 py-0.5 text-[12px] font-medium text-[#6b6f76]">
              {trackedPersonCount !== null && trackedPersonCount > 0
                ? `${trackedPersonCount} tracked`
                : `${employeesStr} People`}
            </span>
          )}
          {fundingStr && (
            <span className="rounded-md border border-[#e6e6e9] bg-[#f5f5f7] px-2.5 py-0.5 text-[12px] font-medium text-[#6b6f76]">
              {fundingStr} Raised
            </span>
          )}
          {enabledSkills.length > 0 && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowSkillsModal(true); }}
              className="rounded-md border border-[#e6e6e9] bg-[#f5f5f7] px-2.5 py-0.5 text-[12px] font-medium text-[#6b6f76] transition-colors hover:border-[#d4d4d8] hover:bg-[#ededf0]"
            >
              {skillCount > 0 ? `${skillCount} Skill` : "Skills"}
            </button>
          )}
          {/* More menu */}
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
          </div>
        </div>
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
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowMenu(false); setShowDeleteModal(true); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-red-600 hover:bg-red-50 transition-colors"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                Delete
              </button>
            </div>
          </>
        )}
      </div>

      {showSkillsModal && company._id && (
        <SkillsModal
          companyId={company._id}
          companyName={name}
          enabledSkills={enabledSkills}
          atsInfo={atsInfo}
          onClose={() => setShowSkillsModal(false)}
          onDetectATS={onDetectATS}
          isDetectingATS={isDetectingATS}
        />
      )}
      {showBuyerProfileModal && company._id && (
        <ChangeBuyerProfileModal
          entityName={name}
          currentProfileId={company.buyerProfileId ?? null}
          allProfiles={allBuyerProfiles}
          isCompany={true}
          onClose={() => setShowBuyerProfileModal(false)}
          onConfirm={async (profileId) => {
            const res = await apiFetch(`${apiBaseUrl}/companies/${company._id}/buyer-profile`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
              body: JSON.stringify({ buyerProfileId: profileId }),
            });
            if (res.ok) {
              onBuyerProfileUpdated(company._id!, profileId);
              setShowBuyerProfileModal(false);
            }
          }}
        />
      )}
      {showDeleteModal && company._id && (
        <DeleteCompanyModal
          companyId={company._id}
          companyName={name}
          apiBaseUrl={apiBaseUrl}
          authToken={authToken}
          onClose={() => setShowDeleteModal(false)}
          onConfirm={async () => {
            await onRemove(company._id!);
            setShowDeleteModal(false);
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeleton Card                                                       */
/* ------------------------------------------------------------------ */

function SkeletonCard() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[#e6e6e9] bg-white px-3.5 py-2.5">
      <div className="h-10 w-10 rounded-lg animate-shimmer shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-36 rounded animate-shimmer" />
        <div className="h-3 w-24 rounded animate-shimmer" />
      </div>
      <div className="hidden sm:flex items-center gap-2">
        <div className="h-6 w-20 rounded-md animate-shimmer" />
        <div className="h-6 w-24 rounded-md animate-shimmer" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 25;

export default function CompaniesPage() {
  const router = useRouter();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const [authToken, setAuthToken] = useState("");
  const [message, setMessage] = useState("");
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [atsData, setATSData] = useState<Record<string, { detectionStatus?: string; atsName?: string | null; careerPageUrl?: string | null }>>({});
  const [enabledSkills, setEnabledSkills] = useState<SkillRecord[]>([]);
  const [isDetectingATS, setIsDetectingATS] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [buyerProfiles, setBuyerProfiles] = useState<BuyerProfile[]>([]);
  const [personCounts, setPersonCounts] = useState<Record<string, number>>({});
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const storedToken = window.localStorage.getItem(localStorageTokenKey);
    if (!storedToken) { router.replace("/"); return; }
    setAuthToken(storedToken);
  }, [router]);

  useEffect(() => {
    if (!authToken) return;
    void apiFetch(`${apiBaseUrl}/skills`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async (res) => {
        const data = (await safeJson(res)) as { skills?: SkillRecord[] };
        setEnabledSkills((data.skills ?? []).filter((s) => s.enabled));
      })
      .catch(() => {});
    void apiFetch(`${apiBaseUrl}/buyer-profiles`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async (res) => {
        const data = (await safeJson(res)) as { profiles?: BuyerProfile[] };
        setBuyerProfiles(data.profiles ?? []);
      })
      .catch(() => {});
  }, [apiBaseUrl, authToken]);

  const fetchCompanies = useCallback(() => {
    if (!authToken) return;
    setIsLoadingList(true);
    void apiFetch(`${apiBaseUrl}/companies`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async (response) => {
        const result = (await safeJson(response)) as { companies?: CompanyRecord[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Could not load companies");
        const loadedCompanies = result.companies ?? [];
        setCompanies(loadedCompanies);
        loadedCompanies.forEach((company) => {
          if (company._id) {
            void apiFetch(`${apiBaseUrl}/companies/${company._id}/ats`, { headers: { Authorization: `Bearer ${authToken}` } })
              .then(async (res) => {
                const data = (await safeJson(res)) as { ats?: { detectionStatus?: string; atsName?: string | null; careerPageUrl?: string | null } | null };
                if (data.ats && company._id) setATSData((prev) => ({ ...prev, [company._id!]: data.ats! }));
              })
              .catch(() => {});
            void apiFetch(`${apiBaseUrl}/companies/${company._id}/persons`, { headers: { Authorization: `Bearer ${authToken}` } })
              .then(async (res) => {
                const data = (await safeJson(res)) as { persons?: unknown[] };
                if (company._id) setPersonCounts((prev) => ({ ...prev, [company._id!]: (data.persons ?? []).length }));
              })
              .catch(() => {});
          }
        });
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "Could not load companies");
      })
      .finally(() => setIsLoadingList(false));
  }, [apiBaseUrl, authToken]);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  useEffect(() => {
    const handler = () => fetchCompanies();
    window.addEventListener(DATA_CHANGED_EVENT, handler);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, handler);
  }, [fetchCompanies]);

  // Reset display count whenever search changes
  useEffect(() => {
    setDisplayCount(PAGE_SIZE);
  }, [searchQuery]);

  // Infinite scroll sentinel
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setDisplayCount((p) => p + PAGE_SIZE); },
      { rootMargin: "300px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  async function handleRemoveCompany(id: string) {
    try {
      const res = await apiFetch(`${apiBaseUrl}/companies/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${authToken}` } });
      if (!res.ok) {
        const data = (await safeJson(res)) as { error?: string };
        throw new Error(data.error ?? "Could not remove company");
      }
      setCompanies((prev) => prev.filter((c) => c._id !== id));
      dispatchDataChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not remove company");
    }
  }

  function handleBuyerProfileUpdated(companyId: string, buyerProfileId: string | null) {
    setCompanies((prev) => prev.map((c) => c._id === companyId ? { ...c, buyerProfileId } : c));
  }

  async function handleDetectATS(id: string) {
    setIsDetectingATS(id);
    setATSData((prev) => ({ ...prev, [id]: { detectionStatus: "pending" } }));
    try {
      const res = await apiFetch(`${apiBaseUrl}/companies/${id}/detect-ats`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const data = (await safeJson(res)) as { error?: string };
        throw new Error(data.error ?? "Could not detect ATS");
      }
      const result = (await safeJson(res)) as { ats?: { detectionStatus?: string; atsName?: string | null; careerPageUrl?: string | null } };
      if (result.ats) setATSData((prev) => ({ ...prev, [id]: result.ats! }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not detect ATS");
      setATSData((prev) => ({ ...prev, [id]: { detectionStatus: "failed" } }));
    } finally {
      setIsDetectingATS(null);
    }
  }

  const filteredCompanies = useMemo(() => {
    if (!searchQuery.trim()) return companies;
    const q = searchQuery.toLowerCase();
    return companies.filter((c) => {
      const data = getFiberData(c);
      const name = (data?.preferred_name as string | undefined) ?? c.domain;
      const industry = (data?.standard_industries as string[] | undefined)?.[0] ?? "";
      return name.toLowerCase().includes(q) || c.domain.toLowerCase().includes(q) || industry.toLowerCase().includes(q);
    });
  }, [companies, searchQuery]);

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
                placeholder="Search companies…"
                className="w-full rounded-md border border-[#e6e6e9] bg-white py-2.5 pl-10 pr-10 text-[14px] placeholder:text-[#8b8d94] focus:border-[#d4d4d8] focus:bg-white focus:outline-none transition-all"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#8b8d94] hover:text-[#6b6f76]">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              )}
            </div>
            <button
              onClick={() => dispatchGlobalAction("company")}
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
            {filteredCompanies.slice(0, displayCount).map((company) => (
              <CompanyCard
                key={company._id ?? company.domain}
                company={company}
                onRemove={handleRemoveCompany}
                onDetectATS={handleDetectATS}
                atsInfo={company._id ? atsData[company._id] : undefined}
                enabledSkills={enabledSkills}
                isDetectingATS={isDetectingATS}
                buyerProfile={company.buyerProfileId ? buyerProfiles.find((p) => p._id === company.buyerProfileId) : undefined}
                allBuyerProfiles={buyerProfiles}
                onBuyerProfileUpdated={handleBuyerProfileUpdated}
                apiBaseUrl={apiBaseUrl}
                authToken={authToken}
                trackedPersonCount={company._id ? (personCounts[company._id] ?? null) : null}
              />
            ))}
            {filteredCompanies.length === 0 && companies.length > 0 && (
              <div className="flex items-center justify-center py-16">
                <p className="text-[14px] text-[#8b8d94]">No results for &ldquo;{searchQuery}&rdquo;</p>
              </div>
            )}
            {companies.length === 0 && (
              <div className="flex h-64 items-center justify-center">
                <p className="text-[14px] text-[#8b8d94]">No companies yet</p>
              </div>
            )}
            {/* Sentinel for infinite scroll */}
            <div ref={sentinelRef} />
            {displayCount < filteredCompanies.length && (
              <div className="flex justify-center py-4">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#e6e6e9] border-t-[#6b6f76]" />
              </div>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
