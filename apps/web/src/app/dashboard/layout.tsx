"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import { dispatchDataChanged, safeJson, GLOBAL_ACTION_EVENT, DATA_CHANGED_EVENT, dispatchComposeEmail, apiFetch, FallbackImg } from "./components";

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

/* Lucide-style SVG icons (stroke-width 1.75, 16×16) */
const LucideIcon = ({ children }: { children: React.ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">{children}</svg>
);

const icons = {
  home: <LucideIcon><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></LucideIcon>,
  building: <LucideIcon><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v8h4"/><path d="M18 9h2a2 2 0 0 1 2 2v11h-4"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/></LucideIcon>,
  user: <LucideIcon><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></LucideIcon>,
  target: <LucideIcon><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="2"/></LucideIcon>,
  inbox: <LucideIcon><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></LucideIcon>,
  calendar: <LucideIcon><path d="M8 2v4M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></LucideIcon>,
  wand: <LucideIcon><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8l1.4 1.4M17.8 6.2l1.4-1.4"/><path d="M15 9a3 3 0 0 0-3 3"/><path d="m5 21 8-8"/><path d="m5 15 4-4"/></LucideIcon>,
  bolt: <LucideIcon><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></LucideIcon>,
  settings: <LucideIcon><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></LucideIcon>,
  chevronLeft: <LucideIcon><path d="M15 18l-6-6 6-6"/></LucideIcon>,
  person: <LucideIcon><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></LucideIcon>,
  draft: <LucideIcon><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></LucideIcon>,
  group: <LucideIcon><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></LucideIcon>,
  corporate: <LucideIcon><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v8h4"/><path d="M18 9h2a2 2 0 0 1 2 2v11h-4"/></LucideIcon>,
  logout: <LucideIcon><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></LucideIcon>,
  search: <LucideIcon><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></LucideIcon>,
  bell: <LucideIcon><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></LucideIcon>,
  checkSquare: <LucideIcon><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></LucideIcon>,
};

const pipelineIcon = <LucideIcon><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></LucideIcon>;

const primaryNavItems = [
  { label: "Home", href: "/dashboard", icon: icons.home, exact: true },
  { label: "Inbox", href: "/dashboard/inbox", icon: icons.inbox },
  { label: "Tasks", href: "/dashboard/tasks", icon: icons.checkSquare, countKey: "TasksOpen" },
  { label: "Notifications", href: "/dashboard/notifications", icon: icons.bell, countKey: "NotificationsUnread" },
  { label: "Meetings", href: "/dashboard/calendar", icon: icons.calendar },
  { label: "Pipeline", href: "/dashboard/pipeline", icon: pipelineIcon },
  { label: "Companies", href: "/dashboard/companies", icon: icons.building, countKey: "Companies" },
  { label: "People", href: "/dashboard/people", icon: icons.user, countKey: "People" },
];

const workspaceNavItems = [
  { label: "Products", href: "/dashboard/buyer-profiles", icon: icons.target },
  { label: "Skills", href: "/dashboard/skills", icon: icons.wand },
  { label: "Triggers", href: "/dashboard/triggers", icon: icons.bolt },
];

const settingsSubItems = [
  { label: "Profile", href: "/dashboard/settings/profile", icon: icons.person },
  { label: "Email templates", href: "/dashboard/settings/email-templates", icon: icons.draft },
  { label: "General", href: "/dashboard/settings/workspace", icon: icons.corporate },
  { label: "Members", href: "/dashboard/settings/members", icon: icons.group },
];

/* ------------------------------------------------------------------ */
/*  Global Action Modal                                                */
/* ------------------------------------------------------------------ */

type GlobalActionType = "pick" | "company" | "person" | null;

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
  const [showManualBuyerAdd, setShowManualBuyerAdd] = useState(false);
  const [manualBuyerInput, setManualBuyerInput] = useState("");
  const [manualPersonName, setManualPersonName] = useState("");
  const [isManualBuyerLoading, setIsManualBuyerLoading] = useState(false);
  const [manualBuyerError, setManualBuyerError] = useState("");

  const [selectedType, setSelectedType] = useState<"company" | "person" | null>(null);

  // Reset selectedType when modal opens/closes
  useEffect(() => {
    if (actionType === "company" || actionType === "person") {
      setSelectedType(actionType);
    } else if (actionType === "pick") {
      setSelectedType(null);
    }
  }, [actionType]);

  if (!actionType) return null;

  // "pick" step — show type selection
  if (actionType === "pick" && !selectedType) {
    return createPortal(
      <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/30 p-4 pt-[10vh]" onClick={onClose}>
        <div
          className="flex w-full max-w-sm flex-col rounded-xl border border-[#e6e6e9] bg-white shadow-xl animate-slide-up"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-5 pt-4 pb-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-[#1b1b1f]">What would you like to add?</h2>
              <button type="button" onClick={onClose} className="rounded p-1 text-[#8b8d94] transition-colors hover:bg-[#f5f5f7] hover:text-[#6b6f76]">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
          <div className="border-t border-[#ededf0]" />
          <div className="px-5 py-4 flex flex-col gap-2">
            <button
              onClick={() => setSelectedType("company")}
              className="flex items-center gap-3 rounded-lg border border-[#e6e6e9] px-4 py-3.5 text-left transition-all hover:border-[#d4d4d8] hover:bg-[#f9f9fb] hover:shadow-sm"
            >
              <span className="text-[#8b8d94]">{icons.building}</span>
              <div>
                <p className="text-[13px] font-medium text-[#1b1b1f]">Company</p>
                <p className="text-[11px] text-[#8b8d94]">Add a company and find matching buyers</p>
              </div>
            </button>
            <button
              onClick={() => setSelectedType("person")}
              className="flex items-center gap-3 rounded-lg border border-[#e6e6e9] px-4 py-3.5 text-left transition-all hover:border-[#d4d4d8] hover:bg-[#f9f9fb] hover:shadow-sm"
            >
              <span className="text-[#8b8d94]">{icons.user}</span>
              <div>
                <p className="text-[13px] font-medium text-[#1b1b1f]">Person</p>
                <p className="text-[11px] text-[#8b8d94]">Add a person by LinkedIn URL or email</p>
              </div>
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  const effectiveType = selectedType ?? actionType;
  const isCompany = effectiveType === "company";
  const isPerson = effectiveType === "person";
  const isEmail = isPerson && value.includes("@") && !value.includes("linkedin.com");
  const isPersonPreview = isPerson && personPreview !== null;
  const isCompanyPreview = isCompany && companyOnlyPreview !== null;

  function resetPreview() {
    setPersonPreview(null); setCompanyPreview(null); setEnrichment(null);
    setCompanyOnlyPreview(null); setCompanyEnrichmentPayload(null); setCompanyDomain("");
    setBuyers([]); setSelectedBuyerUrls(new Set()); setBuyerProfileId(null);
    setBuyerProfileName(null); setAllBuyerProfiles([]);
    setShowManualBuyerAdd(false); setManualBuyerInput(""); setManualPersonName(""); setIsManualBuyerLoading(false); setManualBuyerError("");
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

  async function handleManualBuyerAdd(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const input = manualBuyerInput.trim();
    if (!input) return;
    setIsManualBuyerLoading(true);
    setManualBuyerError("");
    const isEmailInput = input.includes("@") && !input.includes("linkedin.com");
    try {
      if (isEmailInput) {
        // Email: add directly, no preview needed
        const res = await apiFetch(`${apiBaseUrl}/persons/by-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ email: input, name: manualPersonName.trim() || undefined }),
        });
        const data = (await safeJson(res)) as { error?: string };
        if (!res.ok && res.status !== 409) throw new Error(data.error ?? "Could not add person");
        setManualBuyerInput("");
        setManualPersonName("");
        setShowManualBuyerAdd(false);
      } else {
        // LinkedIn URL: preview then add to buyers selection list
        const linkedinUrl = input.startsWith("http") ? input : `https://www.linkedin.com/in/${input}`;
        const res = await apiFetch(`${apiBaseUrl}/persons/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ linkedinUrl }),
        });
        const data = (await safeJson(res)) as { person?: PersonPreview; _enrichment?: PreviewEnrichment; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Could not look up person");
        const resolvedUrl = data._enrichment?.linkedinUrl ?? linkedinUrl;
        const newBuyer: BuyerPreview = {
          name: data.person?.name ?? input,
          title: data.person?.title,
          profilePic: data.person?.profilePic,
          linkedinUrl: resolvedUrl,
          workEmail: data._enrichment?.workEmail,
          _raw: data._enrichment?.personPayload,
        };
        setBuyers((prev) => (prev.some((b) => b.linkedinUrl === resolvedUrl) ? prev : [...prev, newBuyer]));
        setSelectedBuyerUrls((prev) => new Set([...prev, resolvedUrl]));
        setManualBuyerInput("");
        setShowManualBuyerAdd(false);
      }
    } catch (err) {
      setManualBuyerError(err instanceof Error ? err.message : "Could not add person");
    } finally {
      setIsManualBuyerLoading(false);
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

              {/* Manual person add */}
              {!showManualBuyerAdd ? (
                <button
                  type="button"
                  onClick={() => setShowManualBuyerAdd(true)}
                  className="flex items-center gap-1.5 text-[12px] font-medium text-[#8b8d94] transition-colors hover:text-[#6b6f76]"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Add person manually
                </button>
              ) : (
                <form onSubmit={handleManualBuyerAdd} className="space-y-2">
                  {(() => {
                    const isEmail = manualBuyerInput.includes("@") && !manualBuyerInput.includes("linkedin.com");
                    return (
                      <>
                        <input
                          type="text"
                          value={manualBuyerInput}
                          onChange={(e) => { setManualBuyerInput(e.target.value); setManualPersonName(""); }}
                          placeholder="linkedin.com/in/... or name@company.com"
                          className="w-full rounded-lg border border-[#e6e6e9] bg-white px-3 py-2 text-[13px] placeholder:text-[#b4b5ba] focus:border-[#5e6ad2] focus:outline-none focus:ring-2 focus:ring-[#5e6ad2]/10 transition-all"
                          autoFocus
                        />
                        {isEmail && (
                          <input
                            type="text"
                            value={manualPersonName}
                            onChange={(e) => setManualPersonName(e.target.value)}
                            placeholder="Full name (optional)"
                            className="w-full rounded-lg border border-[#e6e6e9] bg-white px-3 py-2 text-[13px] placeholder:text-[#b4b5ba] focus:border-[#5e6ad2] focus:outline-none focus:ring-2 focus:ring-[#5e6ad2]/10 transition-all"
                          />
                        )}
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => { setShowManualBuyerAdd(false); setManualBuyerInput(""); setManualPersonName(""); setManualBuyerError(""); }}
                            className="text-[12px] text-[#8b8d94] transition-colors hover:text-[#6b6f76]"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={isManualBuyerLoading || !manualBuyerInput.trim()}
                            className="flex items-center gap-1 rounded-md bg-[#1b1b1f] px-3 py-2 text-[12px] font-medium text-white transition-colors hover:bg-[#2c2c33] disabled:opacity-60"
                          >
                            {isManualBuyerLoading ? (
                              <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                            ) : isEmail ? "Add" : "Look up"}
                          </button>
                        </div>
                      </>
                    );
                  })()}
                  {manualBuyerError && <p className="text-[12px] text-red-600">{manualBuyerError}</p>}
                </form>
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
                onClick={() => { if (actionType === "pick") { setSelectedType(null); setValue(""); setError(""); } else { onClose(); } }}
                className="rounded-md border border-[#e6e6e9] px-3 py-1.5 text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7]"
              >
                {actionType === "pick" ? "Back" : "Cancel"}
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

function NavItem({
  label,
  icon,
  isActive,
  onClick,
  count,
  hasDot,
}: {
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
  count?: number;
  hasDot?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex w-full items-center cursor-pointer gap-[9px] rounded-[6px] mx-[2px] text-[13px] font-medium tracking-[-0.005em] transition-all duration-100 ${
        isActive
          ? "bg-white text-[#1b1b1f] shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.04),0_3px_6px_-4px_rgba(0,0,0,0.05)]"
          : "text-[#6b6f76] hover:bg-black/[0.035] hover:text-[#1b1b1f]"
      }`}
      style={{ padding: "8px 9px", width: "calc(100% - 4px)" }}
    >
      {isActive && (
        <span className="absolute left-[-2px] top-1/2 -translate-y-1/2 w-[2px] h-5 bg-[#1b1b1f] rounded-r-[2px]" />
      )}
      <span className={`transition-colors duration-100 ${isActive ? "text-[#1b1b1f]" : "text-[#9ca0a8] group-hover:text-[#1b1b1f]"}`}>
        {icon}
      </span>
      <span className="flex-1 text-left leading-[1.25]">{label}</span>
      {(count !== undefined && count > 0) && (
        <span className={`ml-auto text-[10.5px] font-medium tabular-nums min-w-[18px] text-center rounded-[3px] leading-[1.35] px-[5px] py-[1px] transition-colors duration-100 ${
          isActive ? "bg-[#f5f5f7] text-[#6b6f76]" : "text-[#8b8d94] group-hover:bg-black/[0.04] group-hover:text-[#6b6f76]"
        }`}>
          {count}
        </span>
      )}
      {hasDot && (
        <span className="ml-auto w-[6px] h-[6px] rounded-full bg-[#5e6ad2] shadow-[0_0_0_3px_rgba(94,106,210,0.15)]" />
      )}
    </button>
  );
}

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
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const isSettingsView = pathname.startsWith("/dashboard/settings");

  const displayName = userProfile.fullName ?? userProfile.email;
  const userInitial = displayName.charAt(0).toUpperCase();

  return (
    <aside className="relative flex h-screen w-[248px] shrink-0 flex-col border-r border-[#e6e6e9] bg-[#fafafb]" style={{ padding: "10px 8px 0" }}>
      {/* Brand row */}
      <div className="flex items-center gap-[9px] rounded-[7px]" style={{ padding: "8px 8px 10px", margin: "0 2px 10px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="sidr" className="shrink-0 object-contain" style={{ width: 26, height: 26 }} />
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold text-[#1b1b1f] tracking-[0.05em] leading-[1.15]">
            SIDR
          </div>
        </div>
        {/* + Add dropdown */}
        <div className="relative">
          <button
            onClick={() => setAddOpen((v) => !v)}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1b1b1f] text-white transition-opacity hover:opacity-80"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>
          {addOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setAddOpen(false)} />
              <div className="absolute left-0 top-8 z-50 w-44 rounded-lg border border-[#e6e6e9] bg-white py-1 shadow-[0_4px_16px_rgba(0,0,0,0.10)]">
                {[
                  { label: "Company", type: "company" as const, icon: icons.building },
                  { label: "Person", type: "person" as const, icon: icons.user },
                ].map(({ label, type, icon }) => (
                  <button
                    key={type}
                    onClick={() => { setAddOpen(false); onGlobalAction(type); }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-[#3b3d44] hover:bg-[#f5f5f7] transition-colors"
                  >
                    <span className="text-[#8b8d94]">{icon}</span>
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main navigation */}
      <nav className="flex-none">
        {isSettingsView ? (
          <>
            <button
              onClick={() => router.push("/dashboard")}
              className="group flex w-full items-center cursor-pointer gap-[9px] rounded-[6px] mx-[2px] text-[13px] font-medium text-[#6b6f76] hover:text-[#1b1b1f] hover:bg-black/[0.035] transition-colors mb-1"
              style={{ padding: "8px 9px", width: "calc(100% - 4px)" }}
            >
              <span className="text-[#9ca0a8] group-hover:text-[#1b1b1f] transition-colors">{icons.chevronLeft}</span>
              Settings
            </button>

            <div className="flex flex-col gap-[1px]">
              {settingsSubItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <NavItem
                    key={item.href}
                    label={item.label}
                    icon={item.icon}
                    isActive={isActive}
                    onClick={() => router.push(item.href)}
                  />
                );
              })}
              <button
                onClick={onLogout}
                className="group flex w-full items-center cursor-pointer gap-[9px] rounded-[6px] mx-[2px] text-[13px] font-medium text-red-500 hover:bg-red-50 transition-colors"
                style={{ padding: "8px 9px", width: "calc(100% - 4px)" }}
              >
                <span className="text-red-400">{icons.logout}</span>
                Log out
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Primary nav items */}
            <div className="flex flex-col gap-[1px]">
              {primaryNavItems.map((item) => {
                const isActive = item.exact
                  ? pathname === item.href
                  : pathname.startsWith(item.href);
                const count = item.countKey ? (recordCounts[item.countKey] ?? 0) : undefined;
                const isInbox = item.href === "/dashboard/inbox";
                if (isInbox) {
                  return (
                    <div key={item.href} className="group/inbox relative flex items-center">
                      <button
                        onClick={() => router.push(item.href)}
                        className={`relative flex flex-1 items-center cursor-pointer gap-[9px] rounded-[6px] mx-[2px] text-[13px] font-medium tracking-[-0.005em] transition-all duration-100 ${
                          isActive
                            ? "bg-white text-[#1b1b1f] shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.04),0_3px_6px_-4px_rgba(0,0,0,0.05)]"
                            : "text-[#6b6f76] hover:bg-black/[0.035] hover:text-[#1b1b1f]"
                        }`}
                        style={{ padding: "8px 9px", width: "calc(100% - 4px)" }}
                      >
                        {isActive && (
                          <span className="absolute left-[-2px] top-1/2 -translate-y-1/2 w-[2px] h-5 bg-[#1b1b1f] rounded-r-[2px]" />
                        )}
                        <span className={`transition-colors duration-100 ${isActive ? "text-[#1b1b1f]" : "text-[#9ca0a8] group-hover/inbox:text-[#1b1b1f]"}`}>
                          {item.icon}
                        </span>
                        <span className="flex-1 text-left leading-[1.25]">{item.label}</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); dispatchComposeEmail(); }}
                        className="absolute right-[6px] opacity-0 group-hover/inbox:opacity-100 transition-opacity rounded p-[3px] text-[#9ca0a8] hover:text-[#1b1b1f] hover:bg-black/[0.06]"
                        title="Compose email"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>
                        </svg>
                      </button>
                    </div>
                  );
                }
                return (
                  <NavItem
                    key={item.href}
                    label={item.label}
                    icon={item.icon}
                    isActive={isActive}
                    onClick={() => router.push(item.href)}
                    count={count}
                  />
                );
              })}
            </div>

            {/* Divider */}
            <div className="h-px bg-[#e6e6e9] mx-[10px] my-[10px]" />

            {/* Workspace group — collapsible */}
            <div>
              <button
                onClick={() => setWorkspaceOpen((v) => !v)}
                className="flex items-center gap-[6px] w-full cursor-pointer select-none"
                style={{ padding: "4px 10px 6px", fontSize: "10.5px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", color: "#8b8d94" }}
              >
                <svg
                  className="transition-transform duration-150"
                  style={{ color: "#8b8d94", opacity: 0.55, transform: workspaceOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                  width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                >
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
                <span>Workspace</span>
              </button>

              {workspaceOpen && (
                <div className="flex flex-col gap-[1px]">
                  {workspaceNavItems.map((item) => {
                    const isActive = pathname.startsWith(item.href);
                    const countKey = (item as { countKey?: string }).countKey;
                    const count = countKey ? (recordCounts[countKey] ?? 0) : undefined;
                    return (
                      <NavItem
                        key={item.href}
                        label={item.label}
                        icon={item.icon}
                        isActive={isActive}
                        onClick={() => router.push(item.href)}
                        count={count}
                      />
                    );
                  })}
                </div>
              )}
            </div>

          </>
        )}
      </nav>

      {/* Spacer */}
      <div className="flex-1 min-h-2" />

      {/* User footer */}
      <div
        className="flex items-center gap-[9px] cursor-pointer transition-colors hover:bg-black/[0.025] border-t border-[#e6e6e9]"
        style={{ padding: "9px 12px", margin: "10px -8px 0", height: 54 }}
        onClick={() => router.push("/dashboard/settings/profile")}
      >
        <div className="relative w-7 h-7 shrink-0">
          <div className="w-7 h-7 rounded-full overflow-hidden" style={{ background: "linear-gradient(135deg, #a7a7b3, #6b6f76)" }}>
            <FallbackImg src={userProfile.profilePhotoUrl} className="h-full w-full object-cover">
              <div className="flex h-full w-full items-center justify-center text-[11px] font-semibold text-white">
                {userInitial}
              </div>
            </FallbackImg>
          </div>
          <span className="absolute -right-[1px] -bottom-[1px] w-[9px] h-[9px] rounded-full bg-[#10b981] border-2 border-[#fafafb]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-medium text-[#1b1b1f] leading-[1.2] truncate">{displayName}</div>
          <div className="text-[11px] text-[#8b8d94] leading-[1.2] mt-[1px] truncate">{userProfile.email}</div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); router.push("/dashboard/settings/profile"); }}
          className="shrink-0 p-1 rounded text-[#8b8d94] transition-colors hover:bg-black/[0.05] hover:text-[#1b1b1f]"
          aria-label="Account menu"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
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
      apiFetch(`${apiBaseUrl}/notifications/unread-count`, { headers: { Authorization: `Bearer ${token}` } })
        .then(async (r) => {
          const d = (await safeJson(r)) as { unreadCount?: number };
          return d.unreadCount ?? 0;
        })
        .catch(() => 0),
      apiFetch(`${apiBaseUrl}/tasks`, { headers: { Authorization: `Bearer ${token}` } })
        .then(async (r) => {
          const d = (await safeJson(r)) as { tasks?: { status?: string }[] };
          return (d.tasks ?? []).filter((t) => t.status === "open").length;
        })
        .catch(() => 0),
    ]).then(([companies, people, notificationsUnread, tasksOpen]) => {
      setRecordCounts({ Companies: companies, People: people, NotificationsUnread: notificationsUnread, TasksOpen: tasksOpen });
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
    window.addEventListener("gtmbench:notifications-updated", handler);
    window.addEventListener("gtmbench:tasks-updated", handler);
    // Poll so the sidebar badges stay fresh
    const interval = window.setInterval(handler, 60_000);
    return () => {
      window.removeEventListener(DATA_CHANGED_EVENT, handler);
      window.removeEventListener("gtmbench:notifications-updated", handler);
      window.removeEventListener("gtmbench:tasks-updated", handler);
      window.clearInterval(interval);
    };
  }, [authToken, fetchCounts]);

  useEffect(() => {
    const storedToken = window.localStorage.getItem(localStorageTokenKey);
    if (!storedToken) {
      router.replace("/");
      return;
    }

    void (async () => {
      setAuthToken(storedToken);
      try {
        const response = await apiFetch(`${apiBaseUrl}/me`, {
          headers: { Authorization: `Bearer ${storedToken}` },
        });
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
      } catch {
        window.localStorage.removeItem(localStorageTokenKey);
        router.replace("/");
      }
    })();
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
