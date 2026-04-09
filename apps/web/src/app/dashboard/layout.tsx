"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import { dispatchDataChanged, safeJson, GLOBAL_ACTION_EVENT, DATA_CHANGED_EVENT, apiFetch, FallbackImg } from "./components";

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

const settingsSubItems = [
  { label: "Profile", href: "/dashboard/settings/profile", icon: <MI name="person" /> },
  { label: "Email templates", href: "/dashboard/settings/email-templates", icon: <MI name="draft" /> },
  { label: "General", href: "/dashboard/settings/workspace", icon: <MI name="corporate_fare" /> },
  { label: "Members", href: "/dashboard/settings/members", icon: <MI name="group" /> },
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
  const [buyerProfileName, setBuyerProfileName] = useState<string | null>(null);
  const [allBuyerProfiles, setAllBuyerProfiles] = useState<{ _id: string; name: string; isDefault: boolean }[]>([]);
  const [isSwitchingProfile, setIsSwitchingProfile] = useState(false);

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
    setBuyerProfileName(null); setAllBuyerProfiles([]);
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
          buyerProfileName?: string;
          allProfiles?: { _id: string; name: string; isDefault: boolean }[];
          _enrichment?: { companyPayload?: unknown; domain?: string };
          error?: string;
        };
        if (!response.ok) throw new Error(result.error ?? "Could not look up company");
        setCompanyOnlyPreview(result.company ?? { domain: value.trim() });
        setCompanyEnrichmentPayload(result._enrichment?.companyPayload ?? null);
        setCompanyDomain(result._enrichment?.domain ?? value.trim());
        setBuyerProfileId(result.buyerProfileId ?? null);
        setBuyerProfileName(result.buyerProfileName ?? null);
        setAllBuyerProfiles(result.allProfiles ?? []);
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

  async function handleSwitchBuyerProfile(profileId: string): Promise<void> {
    if (profileId === buyerProfileId || isSwitchingProfile) return;
    setIsSwitchingProfile(true);
    setError("");
    try {
      const res = await apiFetch(`${apiBaseUrl}/companies/search-buyers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ domain: companyDomain, buyerProfileId: profileId }),
      });
      const data = (await safeJson(res)) as {
        buyers?: BuyerPreview[];
        buyerProfileId?: string;
        buyerProfileName?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Could not load buyers");
      const found = (data.buyers ?? []).filter((b) => b.linkedinUrl);
      setBuyers(found);
      setBuyerProfileId(data.buyerProfileId ?? null);
      setBuyerProfileName(data.buyerProfileName ?? null);
      setSelectedBuyerUrls(new Set(found.map((b) => b.linkedinUrl!)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch profile");
    } finally {
      setIsSwitchingProfile(false);
    }
  }

  const placeholder = isCompany
    ? "Enter a domain (e.g. acme.com)"
    : "LinkedIn URL or work email (e.g. john@acme.com)";

  const isPreviewStep = isPersonPreview || isCompanyPreview;
  const step = isPreviewStep ? 2 : 1;
  const title = isCompany ? "Add Company" : "Add Person";

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/30 p-4 pt-[10vh]" onClick={onClose}>
      <div
        className={`flex w-full max-w-md flex-col rounded-xl border border-[#e6e6e9] bg-white shadow-xl animate-slide-up`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-4 pb-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-[#1b1b1f]">{title}</h2>
            <button type="button" onClick={onClose} className="rounded p-1 text-[#8b8d94] transition-colors hover:bg-[#f5f5f7] hover:text-[#6b6f76]">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          {/* Step indicator */}
          <div className="mt-3 flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${step >= 1 ? "bg-[#1b1b1f] text-white" : "bg-[#f5f5f7] text-[#8b8d94]"}`}>1</div>
              <span className={`text-[12px] font-medium ${step === 1 ? "text-[#1b1b1f]" : "text-[#8b8d94]"}`}>Look up</span>
            </div>
            <div className="h-px w-6 bg-[#e6e6e9]" />
            <div className="flex items-center gap-1.5">
              <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${step >= 2 ? "bg-[#1b1b1f] text-white" : "bg-[#f5f5f7] text-[#8b8d94]"}`}>2</div>
              <span className={`text-[12px] font-medium ${step === 2 ? "text-[#1b1b1f]" : "text-[#8b8d94]"}`}>Review & add</span>
            </div>
          </div>
        </div>

        <div className="border-t border-[#ededf0]" />

        {isCompanyPreview ? (
          <>
            <div className="px-5 py-4 space-y-4">
              {/* Company card */}
              <div className="flex items-center gap-3">
                <FallbackImg src={companyOnlyPreview?.logo} className="h-10 w-10 rounded-lg object-contain shrink-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#f5f5f7] text-[14px] font-medium text-[#8b8d94] shrink-0">
                    {(companyOnlyPreview?.name ?? companyDomain ?? "?").charAt(0).toUpperCase()}
                  </div>
                </FallbackImg>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-[#1b1b1f] truncate">{companyOnlyPreview?.name ?? companyDomain}</p>
                  <p className="text-[12px] text-[#8b8d94] truncate">{companyDomain}</p>
                </div>
                <svg className="h-4 w-4 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
              </div>
              {companyOnlyPreview?.description && (
                <p className="text-[12px] text-[#6b6f76] leading-relaxed line-clamp-2">{companyOnlyPreview.description}</p>
              )}

              {/* Buyer profile switcher */}
              {allBuyerProfiles.length > 1 && (
                <div className="rounded-lg border border-[#e6e6e9] px-3 py-2.5">
                  <p className="text-[11px] font-medium text-[#8b8d94] uppercase tracking-wider mb-2">Buyer Profile</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {allBuyerProfiles.map((p) => (
                      <button
                        key={p._id}
                        type="button"
                        disabled={isSwitchingProfile}
                        onClick={() => handleSwitchBuyerProfile(p._id)}
                        className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors disabled:opacity-50 ${
                          buyerProfileId === p._id
                            ? "border-[#1b1b1f] bg-[#1b1b1f] text-white"
                            : "border-[#e6e6e9] bg-white text-[#6b6f76] hover:border-[#d4d4d8]"
                        }`}
                      >
                        {p.name}
                      </button>
                    ))}
                    {isSwitchingProfile && (
                      <span className="text-[11px] text-[#8b8d94]">Loading…</span>
                    )}
                  </div>
                </div>
              )}

              {/* Buyers list */}
              {buyers.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[12px] font-medium text-[#6b6f76]">
                      Matching buyers ({buyers.length})
                    </p>
                    <button
                      type="button"
                      onClick={toggleAllBuyers}
                      className="text-[11px] font-medium text-[#8b8d94] hover:text-[#6b6f76] transition-colors"
                    >
                      {selectedBuyerUrls.size === buyers.length ? "Deselect all" : "Select all"}
                    </button>
                  </div>
                  <div className="max-h-[240px] overflow-y-auto rounded-lg border border-[#e6e6e9] divide-y divide-[#ededf0]">
                    {buyers.map((buyer) => {
                      const isSelected = buyer.linkedinUrl ? selectedBuyerUrls.has(buyer.linkedinUrl) : false;
                      return (
                        <label
                          key={buyer.linkedinUrl}
                          className={`flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-colors ${isSelected ? "bg-[#f9f9fb]" : "hover:bg-[#fafafb]"}`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => buyer.linkedinUrl && toggleBuyer(buyer.linkedinUrl)}
                            className="h-3.5 w-3.5 rounded border-[#d4d4d8] text-[#5e6ad2] shrink-0"
                          />
                          <FallbackImg src={buyer.profilePic} className="h-7 w-7 rounded-full object-cover shrink-0">
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f5f5f7] text-[10px] font-medium text-[#8b8d94] shrink-0">
                              {buyer.name.charAt(0).toUpperCase()}
                            </div>
                          </FallbackImg>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-medium text-[#1b1b1f] truncate">{buyer.name}</p>
                            {buyer.title && <p className="text-[11px] text-[#8b8d94] truncate">{buyer.title}</p>}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-[#e6e6e9] px-4 py-6 text-center">
                  <p className="text-[12px] text-[#8b8d94]">
                    No matching buyers found{buyerProfileName ? ` for "${buyerProfileName}"` : ""}.
                  </p>
                </div>
              )}

              {error && <p className="text-[12px] text-red-600">{error}</p>}
            </div>

            <div className="flex items-center justify-between border-t border-[#ededf0] px-5 py-3">
              <button type="button" onClick={resetPreview} className="rounded-md border border-[#e6e6e9] px-3 py-1.5 text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7]">
                Back
              </button>
              <button
                type="button"
                onClick={handleCompanyConfirm}
                disabled={confirming}
                className="rounded-md bg-[#1b1b1f] px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#2c2c33] disabled:opacity-60"
              >
                {confirming ? "Adding..." : `Add company${selectedBuyerUrls.size > 0 ? ` + ${selectedBuyerUrls.size} buyer${selectedBuyerUrls.size !== 1 ? "s" : ""}` : ""}`}
              </button>
            </div>
          </>
        ) : isPersonPreview ? (
          <>
            <div className="px-5 py-4 space-y-4">
              {/* Person card */}
              <div className="flex items-center gap-3">
                <FallbackImg src={personPreview?.profilePic} className="h-10 w-10 rounded-full object-cover shrink-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f5f5f7] text-[15px] font-medium text-[#8b8d94] shrink-0">
                    {(personPreview?.name ?? "?").charAt(0).toUpperCase()}
                  </div>
                </FallbackImg>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-[#1b1b1f] truncate">{personPreview?.name || "Unknown"}</p>
                  {personPreview?.title && <p className="text-[12px] text-[#6b6f76] truncate">{personPreview.title}</p>}
                  {personPreview?.workEmail && <p className="text-[11px] text-[#8b8d94] truncate">{personPreview.workEmail}</p>}
                </div>
                <svg className="h-4 w-4 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
              </div>

              {/* Company preview */}
              {(companyPreview || personPreview?.companyDomain) && (
                <div className="rounded-lg border border-[#e6e6e9] p-3">
                  <p className="text-[11px] font-medium text-[#8b8d94] uppercase tracking-wider mb-2">Company</p>
                  <div className="flex items-center gap-2.5">
                    <FallbackImg src={companyPreview?.logo} className="h-8 w-8 rounded-lg object-contain shrink-0">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f5f5f7] text-[11px] font-medium text-[#8b8d94] shrink-0">
                        {(companyPreview?.name ?? personPreview?.companyName ?? personPreview?.companyDomain ?? "?").charAt(0).toUpperCase()}
                      </div>
                    </FallbackImg>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-[#1b1b1f] truncate">
                        {companyPreview?.name ?? personPreview?.companyName ?? personPreview?.companyDomain}
                      </p>
                      {(companyPreview?.domain ?? personPreview?.companyDomain) && (
                        <p className="text-[11px] text-[#8b8d94] truncate">{companyPreview?.domain ?? personPreview?.companyDomain}</p>
                      )}
                    </div>
                  </div>
                  {companyPreview?.description && (
                    <p className="mt-2 text-[11px] text-[#6b6f76] leading-relaxed line-clamp-2">{companyPreview.description}</p>
                  )}
                </div>
              )}

              {!companyPreview && !personPreview?.companyDomain && (
                <div className="rounded-lg border border-dashed border-[#e6e6e9] px-4 py-6 text-center">
                  <p className="text-[12px] text-[#8b8d94]">No company information found.</p>
                </div>
              )}

              {error && <p className="text-[12px] text-red-600">{error}</p>}
            </div>

            <div className="flex items-center justify-between border-t border-[#ededf0] px-5 py-3">
              <button type="button" onClick={resetPreview} className="rounded-md border border-[#e6e6e9] px-3 py-1.5 text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7]">
                Back
              </button>
              <button
                type="button"
                onClick={handlePersonConfirm}
                disabled={confirming}
                className="rounded-md bg-[#1b1b1f] px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#2c2c33] disabled:opacity-60"
              >
                {confirming ? "Adding..." : "Confirm & Add"}
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="px-5 py-4">
              <label className="block text-[12px] font-medium text-[#6b6f76] mb-1.5">
                {isCompany ? "Company domain" : isEmail ? "Work email" : "LinkedIn URL or email"}
              </label>
              <input
                className="w-full rounded-lg border border-[#e6e6e9] bg-white px-3 py-2.5 text-[13px] placeholder:text-[#b4b5ba] focus:border-[#5e6ad2] focus:outline-none focus:ring-2 focus:ring-[#5e6ad2]/10 transition-all"
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={placeholder}
                autoFocus
                required
              />
              <p className="mt-2 text-[12px] text-[#8b8d94] leading-relaxed">
                {isCompany
                  ? "We\u2019ll enrich the company and find matching buyers automatically."
                  : "We\u2019ll enrich their profile and find their company automatically."}
              </p>
              {error && <p className="mt-2 text-[12px] text-red-600">{error}</p>}
            </div>

            <div className="flex items-center justify-between border-t border-[#ededf0] px-5 py-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-[#e6e6e9] px-3 py-1.5 text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="rounded-md bg-[#1b1b1f] px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#2c2c33] disabled:opacity-60"
              >
                {isLoading ? "Looking up..." : "Look up"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
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
  const [showAddMenu, setShowAddMenu] = useState(false);
  const isSettingsView = pathname.startsWith("/dashboard/settings");

  const displayName = userProfile.fullName ?? userProfile.email;
  const userInitial = displayName.charAt(0).toUpperCase();

  return (
    <aside className="relative flex h-screen w-[220px] shrink-0 flex-col border-r border-[#e6e6e9] bg-[#fbfbfc]">
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="sidr" className="shrink-0 object-contain" style={{ width: 40, height: 40 }} />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {isSettingsView ? (
          <>
            {/* Back to main nav */}
            <button
              onClick={() => router.push("/dashboard")}
              className="group flex w-full items-center cursor-pointer gap-2 rounded-md px-2.5 py-[6px] text-[13px] font-normal text-[#6b6f76] hover:text-[#1b1b1f] hover:bg-black/[0.03] transition-colors mb-1"
            >
              <svg className="h-4 w-4 shrink-0 text-[#8b8d94] group-hover:text-[#6b6f76] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              Settings
            </button>

            <div className="flex flex-col gap-px">
              {settingsSubItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <button
                    key={item.href}
                    onClick={() => router.push(item.href)}
                    className={`group flex w-full items-center cursor-pointer gap-2 rounded-md px-2.5 py-[6px] text-[13px] transition-colors ${
                      isActive
                        ? "font-medium text-[#1b1b1f] bg-black/[0.04]"
                        : "font-normal text-[#6b6f76] hover:text-[#1b1b1f] hover:bg-black/[0.03]"
                    }`}
                  >
                    <span className={`shrink-0 text-[16px] transition-colors ${isActive ? "text-[#1b1b1f]" : "text-[#8b8d94] group-hover:text-[#6b6f76]"}`}>
                      {item.icon}
                    </span>
                    {item.label}
                  </button>
                );
              })}
              <button
                onClick={onLogout}
                className="group flex w-full items-center cursor-pointer gap-2 rounded-md px-2.5 py-[6px] text-[13px] font-normal text-red-500 hover:bg-red-50 transition-colors"
              >
                <span className="shrink-0 text-[16px]">
                  <MI name="logout" />
                </span>
                Log out
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-px">
              {navItems.map((item) => {
                const isActive = item.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(item.href);
                return (
                  <button
                    key={item.href}
                    onClick={() => router.push(item.href)}
                    className={`group flex w-full items-center cursor-pointer gap-2 rounded-md px-2.5 py-[6px] text-[13px] transition-colors ${
                      isActive
                        ? "font-medium text-[#1b1b1f] bg-black/[0.04]"
                        : "font-normal text-[#6b6f76] hover:text-[#1b1b1f] hover:bg-black/[0.03]"
                    }`}
                  >
                    <span className={`shrink-0 text-[16px] transition-colors ${isActive ? "text-[#1b1b1f]" : "text-[#8b8d94] group-hover:text-[#6b6f76]"}`}>
                      {item.icon}
                    </span>
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex flex-col gap-px">
              <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-[#8b8d94]">Records</p>
              {recordNavItems.map((item) => {
                const isActive = pathname.startsWith(item.href);
                const count = recordCounts[item.label] ?? 0;
                return (
                  <button
                    key={item.href}
                    onClick={() => router.push(item.href)}
                    className={`group flex w-full items-center cursor-pointer gap-2 rounded-md px-2.5 py-[6px] text-[13px] transition-colors ${
                      isActive
                        ? "font-medium text-[#1b1b1f] bg-black/[0.04]"
                        : "font-normal text-[#6b6f76] hover:text-[#1b1b1f] hover:bg-black/[0.03]"
                    }`}
                  >
                    <span className={`shrink-0 text-[16px] transition-colors ${isActive ? "text-[#1b1b1f]" : "text-[#8b8d94] group-hover:text-[#6b6f76]"}`}>
                      {item.icon}
                    </span>
                    {item.label}
                    {count > 0 && (
                      <span className="ml-auto text-[11px] font-normal tabular-nums text-[#8b8d94]">
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </nav>

      {/* Add + button — hidden in settings view */}
      {!isSettingsView && (
        <div className="relative px-2 pb-2">
          <button
            onClick={() => setShowAddMenu((v) => !v)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-[#e6e6e9] bg-white py-[6px] text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7] hover:text-[#1b1b1f]"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add
          </button>

          {showAddMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />
              <div className="absolute bottom-full left-2 right-2 z-50 mb-1 rounded-lg border border-[#e6e6e9] bg-white py-0.5 shadow-sm animate-fade-in">
                <button
                  onClick={() => { setShowAddMenu(false); onGlobalAction("company"); }}
                  className="flex w-full items-center px-3 py-1.5 text-[13px] text-[#6b6f76] transition-colors hover:bg-[#f5f5f7] hover:text-[#1b1b1f]"
                >
                  Company
                </button>
                <button
                  onClick={() => { setShowAddMenu(false); onGlobalAction("person"); }}
                  className="flex w-full items-center px-3 py-1.5 text-[13px] text-[#6b6f76] transition-colors hover:bg-[#f5f5f7] hover:text-[#1b1b1f]"
                >
                  Person
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* User footer */}
      <div className="px-2 pb-2 pt-1 border-t border-[#e6e6e9]">
        <div className="flex w-full items-center gap-2.5 px-2 py-1.5">
          <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-[#e6e6e9]">
            <FallbackImg src={userProfile.profilePhotoUrl} className="h-full w-full object-cover">
              <div className="flex h-full w-full items-center justify-center text-[11px] font-medium text-[#6b6f76]">
                {userInitial}
              </div>
            </FallbackImg>
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-[13px] font-medium text-[#1b1b1f]">{displayName}</p>
          </div>
          <button
            onClick={() => router.push("/dashboard/settings/profile")}
            className="rounded-md p-1.5 transition-colors hover:bg-black/[0.05]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="https://img.icons8.com/?size=100&id=83214&format=png&color=000000" alt="Settings" className="h-4 w-4 opacity-50" />
          </button>
        </div>
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
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-2">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#e6e6e9] border-t-[#6b6f76]" />
          <p className="text-[13px] text-[#8b8d94]">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-white">
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
