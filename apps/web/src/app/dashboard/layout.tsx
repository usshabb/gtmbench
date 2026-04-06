"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { dispatchDataChanged, safeJson, GLOBAL_ACTION_EVENT, DATA_CHANGED_EVENT, apiFetch } from "./components";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

/* ------------------------------------------------------------------ */
/*  Sidebar nav items                                                  */
/* ------------------------------------------------------------------ */

interface UserProfile {
  email: string;
  fullName?: string | null;
  profilePhotoUrl?: string | null;
}

const MI = ({ name }: { name: string }) => (
  <span className="material-symbols-outlined">{name}</span>
);

const navItems = [
  { label: "Home", href: "/dashboard", icon: <MI name="home" /> },
  { label: "Inbox", href: "/dashboard/inbox", icon: <MI name="inbox" /> },
  { label: "Buyer Profile", href: "/dashboard/buyer-profiles", icon: <MI name="badge" /> },
  { label: "Skills", href: "/dashboard/skills", icon: <MI name="category_search" /> },
  { label: "Triggers", href: "/dashboard/triggers", icon: <MI name="bolt" /> },
  { label: "Meetings", href: "/dashboard/calendar", icon: <MI name="calendar_month" /> },
];

const recordNavItems = [
  { label: "Companies", href: "/dashboard/companies", icon: <MI name="corporate_fare" /> },
  { label: "People", href: "/dashboard/people", icon: <MI name="article_person" /> },
];

/* ------------------------------------------------------------------ */
/*  Global Action Modal                                                */
/* ------------------------------------------------------------------ */

type GlobalActionType = "company" | "person" | null;

interface PersonPreview {
  name?: string;
  title?: string;
  profilePic?: string;
  linkedinUrl?: string;
  workEmail?: string;
  companyName?: string;
  companyDomain?: string;
}

interface CompanyPreview {
  domain?: string;
  name?: string;
  logo?: string;
  description?: string;
}

interface PreviewEnrichment {
  personPayload?: unknown;
  companyPayload?: unknown;
  linkedinUrl?: string;
  workEmail?: string;
  companyDomain?: string;
}

interface BuyerPreview {
  name: string;
  title?: string;
  profilePic?: string;
  linkedinUrl?: string;
  workEmail?: string;
  _raw?: unknown;
}

function GlobalActionModal({
  actionType,
  onClose,
  apiBaseUrl,
  authToken,
}: {
  actionType: GlobalActionType;
  onClose: () => void;
  apiBaseUrl: string;
  authToken: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  // Person preview state
  const [personPreview, setPersonPreview] = useState<PersonPreview | null>(null);
  const [companyPreview, setCompanyPreview] = useState<CompanyPreview | null>(null);
  const [enrichment, setEnrichment] = useState<PreviewEnrichment | null>(null);

  // Company preview state
  const [companyOnlyPreview, setCompanyOnlyPreview] = useState<CompanyPreview | null>(null);
  const [companyEnrichmentPayload, setCompanyEnrichmentPayload] = useState<unknown>(null);
  const [companyDomain, setCompanyDomain] = useState("");
  const [buyers, setBuyers] = useState<BuyerPreview[]>([]);
  const [selectedBuyerUrls, setSelectedBuyerUrls] = useState<Set<string>>(new Set());
  const [buyerProfileId, setBuyerProfileId] = useState<string | null>(null);

  if (!actionType) return null;

  const isCompany = actionType === "company";
  const isPerson = actionType === "person";
  const isEmail = isPerson && value.includes("@") && !value.includes("linkedin.com");
  const isPersonPreview = isPerson && personPreview !== null;
  const isCompanyPreview = isCompany && companyOnlyPreview !== null;

  function resetPreview() {
    setPersonPreview(null); setCompanyPreview(null); setEnrichment(null);
    setCompanyOnlyPreview(null); setCompanyEnrichmentPayload(null); setCompanyDomain("");
    setBuyers([]); setSelectedBuyerUrls(new Set()); setBuyerProfileId(null);
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      if (isCompany) {
        // Company preview + buyer search
        const response = await apiFetch(`${apiBaseUrl}/companies/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ domain: value.trim() }),
        });
        const result = (await safeJson(response)) as {
          company?: CompanyPreview;
          buyers?: BuyerPreview[];
          buyerProfileId?: string;
          _enrichment?: { companyPayload?: unknown; domain?: string };
          error?: string;
        };
        if (!response.ok) throw new Error(result.error ?? "Could not look up company");
        setCompanyOnlyPreview(result.company ?? { domain: value.trim() });
        setCompanyEnrichmentPayload(result._enrichment?.companyPayload ?? null);
        setCompanyDomain(result._enrichment?.domain ?? value.trim());
        setBuyerProfileId(result.buyerProfileId ?? null);
        const foundBuyers = (result.buyers ?? []).filter((b: BuyerPreview) => b.linkedinUrl);
        setBuyers(foundBuyers);
        // Select all by default
        setSelectedBuyerUrls(new Set(foundBuyers.map((b: BuyerPreview) => b.linkedinUrl!)));
      } else {
        // Person preview
        const body = isEmail
          ? { email: value.trim() }
          : { linkedinUrl: value.startsWith("http") ? value : `https://www.linkedin.com/in/${value}` };
        const response = await apiFetch(`${apiBaseUrl}/persons/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
          body: JSON.stringify(body),
        });
        const result = (await safeJson(response)) as {
          person?: PersonPreview;
          company?: CompanyPreview;
          _enrichment?: PreviewEnrichment;
          error?: string;
        };
        if (!response.ok) throw new Error(result.error ?? "Could not enrich person");
        setPersonPreview(result.person ?? {});
        setCompanyPreview(result.company ?? null);
        setEnrichment(result._enrichment ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  }

  async function handlePersonConfirm(): Promise<void> {
    setConfirming(true);
    setError("");
    try {
      const response = await apiFetch(`${apiBaseUrl}/persons/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          linkedinUrl: enrichment?.linkedinUrl,
          workEmail: enrichment?.workEmail,
          companyDomain: enrichment?.companyDomain,
          personPayload: enrichment?.personPayload,
          companyPayload: enrichment?.companyPayload,
        }),
      });
      const result = (await safeJson(response)) as { error?: string };
      if (!response.ok && response.status !== 409) throw new Error(result.error ?? "Could not add person");
      onClose();
      router.push("/dashboard/people");
      dispatchDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setConfirming(false);
    }
  }

  async function handleCompanyConfirm(): Promise<void> {
    setConfirming(true);
    setError("");
    try {
      const selected = buyers
        .filter((b) => b.linkedinUrl && selectedBuyerUrls.has(b.linkedinUrl))
        .map((b) => ({ linkedinUrl: b.linkedinUrl!, workEmail: b.workEmail, _raw: b._raw }));
      const response = await apiFetch(`${apiBaseUrl}/companies/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          domain: companyDomain,
          companyPayload: companyEnrichmentPayload,
          buyerProfileId,
          selectedBuyers: selected,
        }),
      });
      const result = (await safeJson(response)) as { error?: string };
      if (!response.ok && response.status !== 409) throw new Error(result.error ?? "Could not add company");
      onClose();
      router.push("/dashboard/companies");
      dispatchDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setConfirming(false);
    }
  }

  function toggleBuyer(url: string) {
    setSelectedBuyerUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url); else next.add(url);
      return next;
    });
  }

  function toggleAllBuyers() {
    if (selectedBuyerUrls.size === buyers.length) {
      setSelectedBuyerUrls(new Set());
    } else {
      setSelectedBuyerUrls(new Set(buyers.map((b) => b.linkedinUrl!)));
    }
  }

  const title = isCompanyPreview
    ? "Add Company & Buyers"
    : isPersonPreview
      ? "Confirm Person"
      : isCompany
        ? "Add Company"
        : "Add Person";

  const placeholder = isCompany
    ? "Enter a domain (e.g. acme.com)"
    : "LinkedIn URL or work email (e.g. john@acme.com)";

  const isPreviewStep = isPersonPreview || isCompanyPreview;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh] backdrop-blur-[2px]" onClick={onClose}>
      <div
        className={`flex w-full flex-col rounded-xl bg-white shadow-xl animate-slide-up ${isCompanyPreview ? "max-w-lg" : "max-w-md"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4">
          <h2 className="text-[17px] font-bold text-zinc-900">{title}</h2>
          <button type="button" onClick={onClose} className="ml-4 mt-0.5 rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {isCompanyPreview ? (
          <>
            <div className="px-5 pb-4 space-y-4">
              {/* Company info */}
              <div className="flex items-center gap-3">
                {companyOnlyPreview?.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={companyOnlyPreview.logo} alt="" className="h-10 w-10 rounded-lg object-contain shrink-0" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-sm font-bold text-zinc-400 shrink-0">
                    {(companyOnlyPreview?.name ?? companyDomain ?? "?").charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-zinc-900 truncate">{companyOnlyPreview?.name ?? companyDomain}</p>
                  {companyDomain && <p className="text-[11px] text-zinc-400">{companyDomain}</p>}
                </div>
              </div>
              {companyOnlyPreview?.description && (
                <p className="text-[11px] text-zinc-500 line-clamp-2">{companyOnlyPreview.description}</p>
              )}

              {/* Buyers list */}
              {buyers.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[12px] font-semibold text-zinc-700">
                      Buyers found ({buyers.length})
                    </p>
                    <button
                      type="button"
                      onClick={toggleAllBuyers}
                      className="text-[11px] font-medium text-zinc-500 hover:text-zinc-700"
                    >
                      {selectedBuyerUrls.size === buyers.length ? "Deselect all" : "Select all"}
                    </button>
                  </div>
                  <div className="max-h-[280px] overflow-y-auto rounded-lg border border-zinc-200 divide-y divide-zinc-100">
                    {buyers.map((buyer) => {
                      const isSelected = buyer.linkedinUrl ? selectedBuyerUrls.has(buyer.linkedinUrl) : false;
                      return (
                        <label
                          key={buyer.linkedinUrl}
                          className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${isSelected ? "bg-zinc-50" : "hover:bg-zinc-25"}`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => buyer.linkedinUrl && toggleBuyer(buyer.linkedinUrl)}
                            className="h-3.5 w-3.5 rounded border-zinc-300 text-zinc-900 shrink-0"
                          />
                          {buyer.profilePic ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={buyer.profilePic} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-bold text-zinc-400 shrink-0">
                              {buyer.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-medium text-zinc-800 truncate">{buyer.name}</p>
                            {buyer.title && <p className="text-[11px] text-zinc-400 truncate">{buyer.title}</p>}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="text-[12px] text-zinc-400 italic">No buyers found for the default buyer profile.</p>
              )}

              {error && <p className="text-[13px] text-red-600">{error}</p>}
            </div>

            <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-3">
              <button type="button" onClick={resetPreview} className="rounded-lg border border-zinc-200 px-4 py-2 text-[13px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50">
                Back
              </button>
              <button
                type="button"
                onClick={handleCompanyConfirm}
                disabled={confirming}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-black disabled:opacity-60"
              >
                {confirming ? "Adding..." : `Add company${selectedBuyerUrls.size > 0 ? ` + ${selectedBuyerUrls.size} buyer${selectedBuyerUrls.size !== 1 ? "s" : ""}` : ""}`}
              </button>
            </div>
          </>
        ) : isPersonPreview ? (
          <>
            <div className="px-5 pb-4 space-y-4">
              {/* Person preview */}
              <div className="flex items-center gap-3">
                {personPreview?.profilePic ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={personPreview.profilePic} alt="" className="h-12 w-12 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-lg font-bold text-zinc-400 shrink-0">
                    {(personPreview?.name ?? "?").charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-zinc-900 truncate">{personPreview?.name || "Unknown"}</p>
                  {personPreview?.title && <p className="text-[12px] text-zinc-500 truncate">{personPreview.title}</p>}
                  {personPreview?.workEmail && <p className="text-[11px] text-zinc-400 truncate">{personPreview.workEmail}</p>}
                </div>
              </div>

              {/* Company preview */}
              {(companyPreview || personPreview?.companyDomain) && (
                <div className="rounded-lg border border-zinc-200 p-3">
                  <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide mb-2">Company</p>
                  <div className="flex items-center gap-3">
                    {companyPreview?.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={companyPreview.logo} alt="" className="h-8 w-8 rounded-lg object-contain shrink-0" />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-[11px] font-bold text-zinc-400 shrink-0">
                        {(companyPreview?.name ?? personPreview?.companyName ?? personPreview?.companyDomain ?? "?").charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-zinc-800 truncate">
                        {companyPreview?.name ?? personPreview?.companyName ?? personPreview?.companyDomain}
                      </p>
                      {(companyPreview?.domain ?? personPreview?.companyDomain) && (
                        <p className="text-[11px] text-zinc-400 truncate">{companyPreview?.domain ?? personPreview?.companyDomain}</p>
                      )}
                    </div>
                  </div>
                  {companyPreview?.description && (
                    <p className="mt-2 text-[11px] text-zinc-500 line-clamp-2">{companyPreview.description}</p>
                  )}
                </div>
              )}

              {!companyPreview && !personPreview?.companyDomain && (
                <p className="text-[12px] text-zinc-400 italic">No company information found.</p>
              )}

              {error && <p className="text-[13px] text-red-600">{error}</p>}
            </div>

            <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-3">
              <button type="button" onClick={resetPreview} className="rounded-lg border border-zinc-200 px-4 py-2 text-[13px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50">
                Back
              </button>
              <button
                type="button"
                onClick={handlePersonConfirm}
                disabled={confirming}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-black disabled:opacity-60"
              >
                {confirming ? "Adding..." : "Confirm & Add"}
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="px-5 pb-4">
              <label className="block text-[13px] font-semibold text-zinc-800 mb-2">
                {isCompany ? "Domain" : isEmail ? "Work Email" : "LinkedIn URL"}
              </label>
              <input
                className="w-full rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-[13px] placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none transition-all"
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={placeholder}
                autoFocus
                required
              />
              <p className="mt-1.5 text-[12px] text-zinc-400">
                {isCompany
                  ? "We\u2019ll enrich the company and find matching buyers automatically."
                  : "We\u2019ll enrich their profile and find their company automatically."}
              </p>
              {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
            </div>

            <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-[13px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-black disabled:opacity-60"
              >
                {isLoading ? "Looking up..." : "Look up"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar Component                                                  */
/* ------------------------------------------------------------------ */

function Sidebar({
  userProfile,
  onLogout,
  onGlobalAction,
  recordCounts,
}: {
  userProfile: UserProfile;
  onLogout: () => void;
  onGlobalAction: (type: GlobalActionType) => void;
  recordCounts: Record<string, number>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);

  const displayName = userProfile.fullName ?? userProfile.email;
  const userInitial = displayName.charAt(0).toUpperCase();

  return (
    <aside className="relative flex h-screen w-[200px] shrink-0 flex-col bg-white shadow-[inset_-1px_0_0_0_#e8e8e8]">
      <div className="flex items-center gap-2.5 px-5 pt-4 pb-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="sidr" className="shrink-0 object-contain" style={{ width: 50, height: 50 }} />

      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3">
        <div className="flex flex-col gap-0.5">
          {navItems.map((item) => {
            const isActive = item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className={`group flex w-full items-center cursor-pointer gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition-all active:scale-[0.97] active:opacity-70 ${
                  isActive
                    ? "font-bold text-[#050505]"
                    : "font-medium text-black/50 hover:text-black/80 hover:bg-black/[0.03]"
                }`}
              >
                <span className={`shrink-0 transition-colors ${isActive ? "text-[#050505]" : "text-black/30 group-hover:text-black/50"}`}>
                  {item.icon}
                </span>
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-col gap-0.5">
          <p className="px-3 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-black/30">Records</p>
          {recordNavItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            const count = recordCounts[item.label] ?? 0;
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className={`group flex w-full items-center cursor-pointer gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition-all active:scale-[0.97] active:opacity-70 ${
                  isActive
                    ? "font-bold text-[#050505]"
                    : "font-medium text-black/50 hover:text-black/80 hover:bg-black/[0.03]"
                }`}
              >
                <span className={`shrink-0 transition-colors ${isActive ? "text-[#050505]" : "text-black/30 group-hover:text-black/50"}`}>
                  {item.icon}
                </span>
                {item.label}
                {count > 0 && (
                  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-100 px-1.5 text-[11px] font-semibold text-zinc-500">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Add + button */}
      <div className="relative px-3 pb-3">
        <button
          onClick={() => setShowAddMenu((v) => !v)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-black/[0.08] bg-white py-2 text-[14px] font-semibold text-black/70 transition-all hover:bg-black/[0.03] active:scale-[0.97] active:opacity-70"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add
        </button>

        {showAddMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />
            <div className="absolute bottom-full left-3 right-3 z-50 mb-1.5 rounded-xl border border-black/[0.06] bg-white py-1 shadow-lg">
              <button
                onClick={() => { setShowAddMenu(false); onGlobalAction("company"); }}
                className="flex w-full items-center px-3.5 py-2 text-[13px] text-black/60 transition-colors hover:bg-black/[0.03] hover:text-black"
              >
                Company
              </button>
              <button
                onClick={() => { setShowAddMenu(false); onGlobalAction("person"); }}
                className="flex w-full items-center px-3.5 py-2 text-[13px] text-black/60 transition-colors hover:bg-black/[0.03] hover:text-black"
              >
                Person
              </button>
            </div>
          </>
        )}
      </div>

      <div className="relative px-3 pb-2 pt-1.5 shadow-[inset_0_1px_0_0_#e8e8e8]">
        <button
          onClick={() => setShowUserMenu((v) => !v)}
          className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 transition-all hover:bg-black/[0.03] active:scale-[0.98] active:opacity-70"
        >
          <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-[#e3e8ee] ring-2 ring-white">
            {userProfile.profilePhotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={userProfile.profilePhotoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-[#4f566b]">
                {userInitial}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-[13px] font-medium text-[#1a1f36]">{displayName}</p>
            {userProfile.fullName && (
              <p className="truncate text-[11px] text-[#a3acb9]">{userProfile.email}</p>
            )}
          </div>
          <svg className="h-4 w-4 shrink-0 text-[#a3acb9]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
          </svg>
        </button>

        {showUserMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
            <div className="absolute bottom-full left-3 right-3 z-50 mb-1.5 rounded-xl border border-[#e3e8ee] bg-white py-1 shadow-lg animate-fade-in">
              <div className="border-b border-[#e3e8ee] px-3.5 py-2.5">
                <p className="text-[13px] font-medium text-[#1a1f36]">{displayName}</p>
                <p className="mt-0.5 truncate text-[11px] text-[#a3acb9]">{userProfile.email}</p>
              </div>
              <button
                onClick={() => { setShowUserMenu(false); router.push("/dashboard/settings/profile"); }}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-[13px] text-[#4f566b] transition-colors hover:bg-[#f7fafc] hover:text-[#1a1f36]"
              >
                <svg className="h-4 w-4 shrink-0 text-[#a3acb9]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
                Profile
              </button>
              <button
                onClick={() => { setShowUserMenu(false); router.push("/dashboard/settings/workspace"); }}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-[13px] text-[#4f566b] transition-colors hover:bg-[#f7fafc] hover:text-[#1a1f36]"
              >
                <svg className="h-4 w-4 shrink-0 text-[#a3acb9]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                </svg>
                Settings
              </button>
              <div className="my-1 border-t border-[#e3e8ee]" />
              <button
                onClick={() => { setShowUserMenu(false); onLogout(); }}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-[13px] text-red-500 transition-colors hover:bg-red-50"
              >
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/*  Dashboard Layout                                                   */
/* ------------------------------------------------------------------ */

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authToken, setAuthToken] = useState("");
  const [globalAction, setGlobalAction] = useState<GlobalActionType>(null);
  const [recordCounts, setRecordCounts] = useState<Record<string, number>>({});

  const fetchCounts = useCallback((token: string) => {
    void Promise.all([
      apiFetch(`${apiBaseUrl}/companies`, { headers: { Authorization: `Bearer ${token}` } })
        .then(async (r) => {
          const d = (await safeJson(r)) as { companies?: unknown[] };
          return (d.companies ?? []).length;
        })
        .catch(() => 0),
      apiFetch(`${apiBaseUrl}/persons`, { headers: { Authorization: `Bearer ${token}` } })
        .then(async (r) => {
          const d = (await safeJson(r)) as { persons?: unknown[] };
          return (d.persons ?? []).length;
        })
        .catch(() => 0),
    ]).then(([companies, people]) => {
      setRecordCounts({ Companies: companies, People: people });
    });
  }, [apiBaseUrl]);

  useEffect(() => {
    function handleGlobalActionEvent(e: Event) {
      const detail = (e as CustomEvent<{ type: "company" | "person" }>).detail;
      setGlobalAction(detail.type);
    }
    window.addEventListener(GLOBAL_ACTION_EVENT, handleGlobalActionEvent);
    return () => window.removeEventListener(GLOBAL_ACTION_EVENT, handleGlobalActionEvent);
  }, []);

  useEffect(() => {
    if (!authToken) return;
    const handler = () => fetchCounts(authToken);
    window.addEventListener(DATA_CHANGED_EVENT, handler);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, handler);
  }, [authToken, fetchCounts]);

  useEffect(() => {
    const storedToken = window.localStorage.getItem(localStorageTokenKey);
    if (!storedToken) {
      router.replace("/");
      return;
    }

    setAuthToken(storedToken);

    void apiFetch(`${apiBaseUrl}/me`, {
      headers: { Authorization: `Bearer ${storedToken}` },
    })
      .then(async (response) => {
        if (!response.ok) {
          window.localStorage.removeItem(localStorageTokenKey);
          router.replace("/");
          return;
        }
        const data = (await safeJson(response)) as {
          email: string;
          onboardingComplete?: boolean;
          user?: { fullName?: string | null; profilePhotoUrl?: string | null };
        };
        if (!data.onboardingComplete) {
          router.replace("/onboarding");
          return;
        }
        setUserProfile({
          email: data.email,
          fullName: data.user?.fullName ?? null,
          profilePhotoUrl: data.user?.profilePhotoUrl ?? null,
        });
        fetchCounts(storedToken);
      })
      .catch(() => {
        window.localStorage.removeItem(localStorageTokenKey);
        router.replace("/");
      });
  }, [apiBaseUrl, router]);

  function handleLogout(): void {
    window.localStorage.removeItem(localStorageTokenKey);
    router.replace("/");
  }

  if (!userProfile) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f7fafc]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#e3e8ee] border-t-[#5469d4]" />
          <p className="text-[13px] text-[#a3acb9]">Loading workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar userProfile={userProfile} onLogout={handleLogout} onGlobalAction={setGlobalAction} recordCounts={recordCounts} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
      <GlobalActionModal
        actionType={globalAction}
        onClose={() => setGlobalAction(null)}
        apiBaseUrl={apiBaseUrl}
        authToken={authToken}
      />
    </div>
  );
}
