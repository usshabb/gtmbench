"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { LetterAvatar, safeJson, dispatchDataChanged, apiFetch, FallbackImg } from "../../components";

interface EmailTemplate {
  _id: string;
  title: string;
  body: string;
}

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

interface CompanyRecord {
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

interface EmailThread {
  id: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  sourceUserEmail?: string;
  sourceUserName?: string;
  sourceUserPhoto?: string | null;
}

const localStorageTokenKey = "gtmbench-token";
function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

type TabType = "overview" | "experience" | "email";

export default function PersonDetailPage() {
  return (
    <Suspense>
      <PersonDetailInner />
    </Suspense>
  );
}

function PersonDetailInner() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const [authToken, setAuthToken] = useState("");
  const [person, setPerson] = useState<PersonRecord | null>(null);
  const [companyLead, setCompanyLead] = useState<CompanyRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [isRemoving, setIsRemoving] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [showMenu, setShowMenu] = useState(false);

  // Gmail state
  const [gmailConnected, setGmailConnected] = useState(false);
  const [emails, setEmails] = useState<EmailThread[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sendSuccess, setSendSuccess] = useState(false);
  const gmailChecked = useRef(false);
  const emailsAutoLoaded = useRef(false);

  // Email enrichment state
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState("");
  const [showManualEmail, setShowManualEmail] = useState(false);
  const [manualEmailInput, setManualEmailInput] = useState("");

  // Template picker state
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [emailSignature, setEmailSignature] = useState("");
  const templatesFetched = useRef(false);
  const composeBodyRef = useRef<HTMLTextAreaElement>(null);

  const fetchTemplates = useCallback(async () => {
    if (!authToken || templatesFetched.current) return;
    templatesFetched.current = true;
    try {
      const [tRes, sRes] = await Promise.all([
        apiFetch(`${apiBaseUrl}/email-templates`, { headers: { Authorization: `Bearer ${authToken}` } }),
        apiFetch(`${apiBaseUrl}/email-signature`, { headers: { Authorization: `Bearer ${authToken}` } }),
      ]);
      const tData = (await tRes.json()) as { templates: EmailTemplate[] };
      setEmailTemplates(tData.templates ?? []);
      const sData = (await sRes.json()) as { signature: string };
      setEmailSignature(sData.signature ?? "");
    } catch { /* ignore */ }
  }, [apiBaseUrl, authToken]);

  function execComposeFormat(prefix: string, suffix: string) {
    const ta = composeBodyRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const text = composeBody;
    const selected = text.slice(start, end);
    const newText = text.slice(0, start) + prefix + selected + suffix + text.slice(end);
    setComposeBody(newText);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + prefix.length, end + prefix.length);
    });
  }

  function htmlToPlainText(html: string): string {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.innerText ?? tmp.textContent ?? "";
  }

  function resolveTemplate(tmpl: EmailTemplate) {
    const d = person ? getFiberData(person) : null;
    const firstName = (d?.first_name as string) ?? "";
    const name = d ? getFullName(d, person?.linkedinUrl ?? "") : "";
    const email = composeTo || "";
    const website = person?.companyDomain ?? "";
    const plainBody = htmlToPlainText(tmpl.body);
    const resolved = plainBody
      .replace(/\{\{first_name\}\}/g, firstName)
      .replace(/\{\{full_name\}\}/g, name)
      .replace(/\{\{email\}\}/g, email)
      .replace(/\{\{website\}\}/g, website);
    setComposeSubject(tmpl.title);
    setComposeBody(resolved);
    setShowTemplatePicker(false);
    // Resolve ats_name async if template uses it
    if (companyLead?._id && resolved.includes("{{ats_name}}")) {
      void apiFetch(`${apiBaseUrl}/companies/${companyLead._id}/ats`, { headers: { Authorization: `Bearer ${authToken}` } })
        .then(async (res) => {
          const data = (await res.json()) as { ats: { atsName?: string } | null };
          const atsVal = data.ats?.atsName ?? "";
          setComposeBody((prev) => prev.replace(/\{\{ats_name\}\}/g, atsVal));
        })
        .catch(() => {
          setComposeBody((prev) => prev.replace(/\{\{ats_name\}\}/g, ""));
        });
    }
  }

  async function handleRemove() {
    if (!authToken || !id) return;
    setIsRemoving(true);
    try {
      const res = await apiFetch(`${apiBaseUrl}/persons/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const data = (await safeJson(res)) as { error?: string };
        throw new Error(data.error ?? "Could not remove person");
      }
      dispatchDataChanged();
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
    if (!authToken || gmailChecked.current) return;
    gmailChecked.current = true;
    void apiFetch(`${apiBaseUrl}/gmail/status`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async (res) => {
        const data = (await safeJson(res)) as { connected: boolean };
        setGmailConnected(data.connected);
      })
      .catch(() => {});
  }, [apiBaseUrl, authToken]);

  useEffect(() => {
    if (searchParams.get("gmail") === "connected") {
      setGmailConnected(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!gmailConnected || !person || !authToken || emailsAutoLoaded.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (person.enrichmentData as any)?.output?.data?.[0] as Record<string, any> | null ?? null;
    const email: string = raw?.work_email ?? raw?.emails?.[0] ?? raw?.personal_email ?? raw?.email ?? "";
    if (!email) return;
    emailsAutoLoaded.current = true;
    void loadEmails(email);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gmailConnected, person, authToken]);

  useEffect(() => {
    if (!authToken || !id) return;

    apiFetch(`${apiBaseUrl}/persons/${id}`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error("Person not found");
        const data = (await safeJson(res)) as { person: PersonRecord };
        setPerson(data.person);

        if (data.person.companyDomain) {
          try {
            const companyRes = await apiFetch(`${apiBaseUrl}/companies/by-domain/${data.person.companyDomain}`, {
              headers: { Authorization: `Bearer ${authToken}` },
            });
            if (companyRes.ok) {
              const companyData = (await safeJson(companyRes)) as { company: CompanyRecord };
              setCompanyLead(companyData.company);
            }
          } catch {
            // Company might not be enriched yet
          }
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load person");
      })
      .finally(() => setIsLoading(false));
  }, [apiBaseUrl, authToken, id]);

  async function connectGmail() {
    const res = await apiFetch(
      `${apiBaseUrl}/auth/google/url?returnPath=/dashboard/people/${id}`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );
    const data = (await safeJson(res)) as { url: string };
    if (data.url) window.location.href = data.url;
  }

  async function loadEmails(personEmail: string) {
    if (!authToken || !personEmail) return;
    setEmailsLoading(true);
    try {
      const res = await apiFetch(
        `${apiBaseUrl}/persons/${id}/emails?personEmail=${encodeURIComponent(personEmail)}`,
        { headers: { Authorization: `Bearer ${authToken}` } },
      );
      const data = (await safeJson(res)) as { emails: EmailThread[] };
      setEmails(data.emails ?? []);
    } catch {
      // ignore
    } finally {
      setEmailsLoading(false);
    }
  }

  async function handleSendEmail() {
    if (!composeTo || !composeSubject || !composeBody) return;
    setSending(true);
    setSendError("");
    try {
      const res = await apiFetch(`${apiBaseUrl}/persons/${id}/emails`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ to: composeTo, subject: composeSubject, body: composeBody }),
      });
      if (!res.ok) {
        const data = (await safeJson(res)) as { error?: string };
        throw new Error(data.error ?? "Failed to send");
      }
      setSendSuccess(true);
      setComposeSubject("");
      setComposeBody("");
      setTimeout(() => { setShowCompose(false); setSendSuccess(false); }, 1500);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setSending(false);
    }
  }

  async function handleFindEmail() {
    if (!authToken) return;
    setEnriching(true);
    setEnrichError("");
    try {
      const res = await apiFetch(`${apiBaseUrl}/persons/${id}/find-email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const data = (await safeJson(res)) as { error?: string };
        throw new Error(data.error ?? "Could not find email");
      }
      const data = (await safeJson(res)) as { person: PersonRecord; email: string | null; message?: string };
      if (data.person) setPerson(data.person);
      if (!data.email) {
        setEnrichError("No email found. Try adding it manually.");
      } else {
        setComposeTo(data.email);
        emailsAutoLoaded.current = false;
      }
    } catch (err) {
      setEnrichError(err instanceof Error ? err.message : "Could not find email");
    } finally {
      setEnriching(false);
    }
  }

  async function handleSetManualEmail() {
    const email = manualEmailInput.trim();
    if (!email || !authToken) return;
    setEnriching(true);
    setEnrichError("");
    try {
      const res = await apiFetch(`${apiBaseUrl}/persons/${id}/set-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = (await safeJson(res)) as { error?: string };
        throw new Error(data.error ?? "Failed to save email");
      }
      const data = (await safeJson(res)) as { person: PersonRecord };
      setPerson(data.person);
      emailsAutoLoaded.current = false;
      setShowManualEmail(false);
    } catch (err) {
      setEnrichError(err instanceof Error ? err.message : "Failed to save email");
    } finally {
      setEnriching(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#d4d4d8] border-t-[#6b6f76]" />
      </div>
    );
  }

  if (error || !person) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-[#6b6f76]">{error || "Person not found"}</p>
        <button onClick={() => router.back()} className="text-sm text-[#6b6f76] underline hover:text-[#1b1b1f]">Go back</button>
      </div>
    );
  }

  const data = getFiberData(person);
  const fullName = getFullName(data, person.linkedinUrl);
  const photoUrl = data?.profile_pic as string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentJob = data?.current_job as Record<string, any> | undefined;
  const title = currentJob?.title as string | undefined;
  const company = currentJob?.company_name as string | undefined;
  const location = data ? getLocation(data) : undefined;
  const bio = (data?.summary ?? data?.headline) as string | undefined;
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawData = data as Record<string, any> | null;
  const personEmail: string =
    rawData?.work_email ??
    rawData?.emails?.[0] ??
    rawData?.personal_email ??
    rawData?.email ??
    "";

  const infoItems = [
    { label: "Title", value: title ?? null },
    { label: "Company", value: company ?? null },
    { label: "Seniority", value: seniority ?? null },
    { label: "Industry", value: industry ?? null },
    { label: "Location", value: location ?? null },
    { label: "Connections", value: data?.connection_count ? String(data.connection_count) : null },
  ].filter((s) => s.value != null);

  const companyData = companyLead ? getFiberData(companyLead) : null;
  const companyName = companyData?.preferred_name ?? companyLead?.domain;
  const companyLogo = companyData?.logo_url as string | undefined;
  const companyIndustry = (companyData?.standard_industries as string[] | undefined)?.[0];
  const linkedinSlug = person.linkedinUrl.split("/in/")[1]?.replace(/\/$/, "");

  const tabs: { key: TabType; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "experience", label: "Experience" },
    { key: "email", label: "Email" },
  ];

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="mx-auto max-w-3xl px-4 pt-6 pb-8">
        {/* Header card */}
        <div className="relative flex items-center gap-4 rounded-lg border border-[#e6e6e9] bg-white px-4 py-3">
          <LetterAvatar name={fullName} size="lg" src={photoUrl} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[16px] font-semibold text-[#1b1b1f]">{fullName}</h1>
              {person.enrichmentStatus !== "completed" && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${person.enrichmentStatus === "failed" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"}`}>
                  {person.enrichmentStatus}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-[#8b8d94]">
              {title && company && <span>{title} at {company}</span>}
              {title && company && location && <span>·</span>}
              {location && <span>{location}</span>}
            </div>
            {/* Pills */}
            <div className="mt-2 flex flex-wrap gap-2">
              {linkedinSlug && (
                <a href={person.linkedinUrl} target="_blank" rel="noopener noreferrer" className="rounded-full border border-[#e6e6e9] bg-[#f9f9fb] px-3 py-0.5 text-[11px] font-medium text-[#6b6f76] hover:bg-[#ededf0] transition-colors">LinkedIn</a>
              )}
              {personEmail ? (
                <span className="rounded-full border border-[#e6e6e9] bg-[#f9f9fb] px-3 py-0.5 text-[11px] font-medium text-[#6b6f76]">{personEmail}</span>
              ) : (
                <button
                  onClick={() => void handleFindEmail()}
                  disabled={enriching}
                  className="rounded-full border border-[#e6e6e9] bg-[#f9f9fb] px-3 py-0.5 text-[11px] font-medium text-[#6b6f76] hover:bg-[#ededf0] transition-colors disabled:opacity-50"
                >
                  {enriching ? "Finding..." : "Find Email"}
                </button>
              )}
              {data?.open_to_work && (
                <span className="rounded-full bg-[#ecfdf5] px-3 py-0.5 text-[11px] font-medium text-[#059669]">Open to work</span>
              )}
              {data?.is_hiring && (
                <span className="rounded-full bg-[#eef0ff] px-3 py-0.5 text-[11px] font-medium text-[#5e6ad2]">Hiring</span>
              )}
            </div>
          </div>
          {/* 3-dot menu */}
          <div className="relative self-start">
            <button
              onClick={() => setShowMenu((v) => !v)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-[#8b8d94] transition-all hover:bg-[#ededf0] hover:text-[#6b6f76]"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-8 z-30 w-36 rounded-lg border border-[#e6e6e9] bg-white py-1 shadow-lg">
                  <button
                    onClick={() => { setShowMenu(false); handleRemove(); }}
                    disabled={isRemoving}
                    className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    {isRemoving ? "Removing…" : "Delete"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex gap-0 border-b border-[#e6e6e9]">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 -mb-px text-[13px] font-medium transition-colors ${
                activeTab === tab.key
                  ? "text-[#1b1b1f] border-b-2 border-[#1b1b1f] bg-transparent"
                  : "text-[#8b8d94] hover:text-[#6b6f76] bg-transparent border-none"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "overview" ? (
          <div>
            {/* Company Card */}
            {companyLead && (
              <Link
                href={`/dashboard/companies/${companyLead._id}`}
                className="mt-6 flex items-center gap-4 rounded-lg border border-[#e6e6e9] bg-white px-5 py-4 transition-colors hover:border-[#e6e6e9]"
              >
                <LetterAvatar name={companyName as string ?? "?"} size="md" rounded="lg" src={companyLogo} />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[#8b8d94]">Current Company</p>
                  <p className="text-sm font-semibold text-[#1b1b1f]">{companyName}</p>
                  {companyIndustry && <p className="text-xs text-[#6b6f76]">{companyIndustry}</p>}
                </div>
              </Link>
            )}

            {/* Bio + Details card */}
            {(bio || infoItems.length > 0) && (
              <div className="mt-6 rounded-lg border border-[#e6e6e9] bg-white">
                {bio && (
                  <div className={`px-5 py-4${infoItems.length > 0 ? " border-b border-[#e6e6e9]" : ""}`}>
                    <p className="text-sm leading-relaxed text-[#6b6f76]">{bio}</p>
                  </div>
                )}
                {infoItems.length > 0 && (
                  <div className="px-4 py-3 flex flex-wrap gap-2">
                    {infoItems.map((item) => (
                      <span key={item.label} className="rounded-md border border-[#e6e6e9] bg-[#f9f9fb] px-3 py-1.5 text-[12px]">
                        <span className="text-[#8b8d94]">{item.label}</span>
                        <span className="ml-1.5 font-semibold text-[#1b1b1f]">{item.value}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Skills */}
            {skills && skills.length > 0 && (
              <div className="mt-6 rounded-lg border border-[#e6e6e9] bg-white">
                <div className="px-4 py-3 border-b border-[#e6e6e9]">
                  <h2 className="text-[13px] font-medium text-[#6b6f76]">Skills</h2>
                </div>
                <div className="px-4 py-3 flex flex-wrap gap-1.5">
                  {skills.slice(0, 15).map((skill) => (
                    <span key={skill} className="rounded-md bg-[#f5f5f7] px-2.5 py-1 text-xs font-medium text-[#6b6f76]">{skill}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : activeTab === "experience" ? (
          <div>
            {/* Experience */}
            {experiences && experiences.length > 0 && (
              <div className="mt-6 rounded-lg border border-[#e6e6e9] bg-white">
                <div className="px-4 py-3 border-b border-[#e6e6e9]">
                  <h2 className="text-[13px] font-medium text-[#6b6f76]">Experience</h2>
                </div>
                <div className="px-4 py-3">
                  <div className="relative">
                    {experiences.slice(0, 8).map((exp, i) => (
                      <div key={i} className="flex items-start gap-3 pb-3 last:pb-0">
                        <div className="flex flex-col items-center pt-1.5">
                          <div className={`h-2 w-2 rounded-full shrink-0 ${exp.is_current ? "bg-[#059669]" : "bg-[#d4d4d8]"}`} />
                          {i < Math.min((experiences?.length ?? 0), 8) - 1 && <div className="w-px flex-1 bg-[#e6e6e9] mt-1" style={{ minHeight: 20 }} />}
                        </div>
                        <div className="flex flex-1 items-start justify-between min-w-0">
                          <div>
                            <span className="text-[13px] font-medium text-[#1b1b1f]">{exp.title}</span>
                            {exp.company_name && <span className="ml-1 text-[13px] text-[#6b6f76]">at {exp.company_name}</span>}
                            {exp.is_current && <span className="ml-1.5 rounded bg-[#ecfdf5] px-1.5 py-0.5 text-[10px] font-medium text-[#059669]">Current</span>}
                          </div>
                          <span className="ml-2 shrink-0 text-[11px] text-[#8b8d94]">
                            {exp.start_date?.slice(0, 4)}{exp.end_date ? ` – ${exp.end_date.slice(0, 4)}` : exp.start_date ? " – Present" : ""}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Education */}
            {education && education.length > 0 && (
              <div className="mt-6 rounded-lg border border-[#e6e6e9] bg-white">
                <div className="px-4 py-3 border-b border-[#e6e6e9]">
                  <h2 className="text-[13px] font-medium text-[#6b6f76]">Education</h2>
                </div>
                <div className="divide-y divide-[#ededf0]">
                  {education.slice(0, 4).map((edu, i) => (
                    <div key={i} className="px-4 py-3 text-sm">
                      <span className="font-medium text-[#1b1b1f]">{edu.school_name}</span>
                      {(edu.degree || edu.field_of_study_name) && (
                        <span className="ml-1 text-[#6b6f76]">— {[edu.degree, edu.field_of_study_name].filter(Boolean).join(", ")}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(!experiences || experiences.length === 0) && (!education || education.length === 0) && (
              <div className="mt-6 flex flex-col items-center justify-center py-16 text-center">
                <p className="text-[13px] text-[#8b8d94]">No experience or education data available.</p>
              </div>
            )}
          </div>
        ) : (
          /* Email tab */
          <div className="mt-6">
            {/* Email actions */}
            <div className="rounded-lg border border-[#e6e6e9] bg-white">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#e6e6e9]">
                <h2 className="text-[13px] font-medium text-[#6b6f76]">Email</h2>
                <div className="flex items-center gap-2">
                  {gmailConnected && (
                    <button
                      onClick={() => { setShowCompose(true); if (personEmail) setComposeTo(personEmail); }}
                      className="flex items-center gap-1.5 rounded-md border border-[#e6e6e9] px-2.5 py-1 text-[12px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7]"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                      Compose
                    </button>
                  )}
                  {gmailConnected && personEmail && !emailsLoading && (
                    <button
                      onClick={() => loadEmails(personEmail)}
                      className="text-[11px] text-[#8b8d94] hover:text-[#6b6f76]"
                    >
                      Refresh
                    </button>
                  )}
                </div>
              </div>

              {!gmailConnected && (
                <div className="px-5 py-6 text-center">
                  <p className="text-[13px] text-[#6b6f76] mb-3">Connect Gmail to see email history and send emails.</p>
                  <button
                    onClick={connectGmail}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#e6e6e9] px-3 py-1.5 text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7]"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>
                    Connect Gmail
                  </button>
                </div>
              )}

              {gmailConnected && !personEmail && (
                <div className="px-5 py-5">
                  <p className="mb-1 text-[13px] font-medium text-[#6b6f76]">No email address found.</p>
                  <p className="mb-4 text-[12px] text-[#8b8d94]">Find their email via Fiber, or add it manually.</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void handleFindEmail()}
                      disabled={enriching}
                      className="flex items-center gap-1.5 rounded-lg bg-[#1b1b1f] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#2c2c33] disabled:opacity-50"
                    >
                      {enriching && !showManualEmail ? (
                        <><div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />Finding email...</>
                      ) : "Find Email"}
                    </button>
                    <button
                      onClick={() => { setShowManualEmail((v) => !v); setEnrichError(""); }}
                      className="text-[12px] text-[#8b8d94] hover:text-[#6b6f76] underline"
                    >
                      Add manually
                    </button>
                  </div>
                  {showManualEmail && (
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        type="email"
                        value={manualEmailInput}
                        onChange={(e) => setManualEmailInput(e.target.value)}
                        placeholder="e.g. name@company.com"
                        className="flex-1 rounded-lg border border-[#e6e6e9] bg-[#f9f9fb] px-3 py-2 text-[13px] text-[#1b1b1f] outline-none focus:border-[#5e6ad2] focus:ring-1 focus:ring-[#5e6ad2]/20 focus:bg-white"
                        onKeyDown={(e) => { if (e.key === "Enter") void handleSetManualEmail(); }}
                      />
                      <button
                        onClick={() => void handleSetManualEmail()}
                        disabled={enriching || !manualEmailInput.trim()}
                        className="rounded-lg border border-[#e6e6e9] px-3 py-2 text-[12px] font-medium text-[#6b6f76] hover:bg-[#f5f5f7] disabled:opacity-50"
                      >
                        {enriching && showManualEmail ? "Saving..." : "Save"}
                      </button>
                    </div>
                  )}
                  {enrichError && <p className="mt-2 text-[12px] text-red-500">{enrichError}</p>}
                </div>
              )}

              {gmailConnected && personEmail && emailsLoading && (
                <div className="flex justify-center py-6">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#d4d4d8] border-t-[#6b6f76]" />
                </div>
              )}

              {gmailConnected && personEmail && !emailsLoading && emails.length === 0 && (
                <div className="px-5 py-6 text-center">
                  <p className="text-[13px] text-[#8b8d94]">No email conversations with {personEmail} in your Gmail.</p>
                </div>
              )}

              {emails.length > 0 && (
                <div className="divide-y divide-[#ededf0]">
                  {emails.map((email) => (
                    <div key={email.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-[13px] font-medium text-[#1b1b1f] truncate">{email.subject}</p>
                        <span className="shrink-0 text-[11px] text-[#8b8d94]">
                          {email.date ? new Date(email.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-[#8b8d94] truncate">
                        {email.from.includes(personEmail) ? `From: ${email.from}` : `To: ${email.to}`}
                      </p>
                      {email.snippet && (
                        <p className="mt-1 text-[12px] leading-relaxed text-[#6b6f76] line-clamp-2">{email.snippet}</p>
                      )}
                      {email.sourceUserName && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <span className="text-[10px] text-[#8b8d94]">Synced from</span>
                          <FallbackImg src={email.sourceUserPhoto} className="h-3.5 w-3.5 rounded-full object-cover">
                            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#e6e6e9] text-[7px] font-medium text-[#6b6f76]">
                              {email.sourceUserName.charAt(0).toUpperCase()}
                            </span>
                          </FallbackImg>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Compose modal */}
        {showCompose && (
          <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[8vh]" onClick={() => { if (!sending) { setShowCompose(false); setSendError(""); } }}>
            <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" style={{ maxHeight: "calc(100vh - 16vh)" }} onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between border-b border-[#e6e6e9] px-5 py-3.5">
                <h3 className="text-[14px] font-semibold text-[#1b1b1f]">New Message</h3>
                <div className="flex items-center gap-1">
                  <div className="relative">
                    <button
                      onClick={() => { void fetchTemplates(); setShowTemplatePicker((p) => !p); }}
                      className="rounded-md px-2.5 py-1.5 text-[12px] font-medium text-[#6b6f76] hover:bg-[#f5f5f7] transition-colors"
                    >
                      Use template
                    </button>
                    {showTemplatePicker && (
                      <div className="absolute right-0 top-full mt-1 w-64 rounded-lg border border-[#e6e6e9] bg-white shadow-lg z-20 overflow-hidden max-h-64 overflow-y-auto">
                        {emailTemplates.length === 0 ? (
                          <p className="px-3 py-3 text-[12px] text-[#8b8d94]">No templates yet</p>
                        ) : (
                          emailTemplates.map((t) => (
                            <button
                              key={t._id}
                              onClick={() => resolveTemplate(t)}
                              className="flex w-full flex-col px-3 py-2 text-left hover:bg-[#f9f9fb] transition-colors"
                            >
                              <span className="text-[12px] font-medium text-[#1b1b1f]">{t.title}</span>
                              <span className="text-[11px] text-[#8b8d94] line-clamp-1 font-mono">{t.body}</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <button onClick={() => { setShowCompose(false); setSendError(""); setSendSuccess(false); setShowTemplatePicker(false); }} className="rounded-md p-1.5 text-[#8b8d94] hover:bg-[#f5f5f7]">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>

              {/* Fields */}
              <div className="flex flex-col divide-y divide-[#f0f3f8]">
                <div className="flex items-center gap-3 px-5 py-2.5">
                  <span className="w-12 shrink-0 text-[13px] text-[#8b8d94]">To</span>
                  <input
                    type="email"
                    value={composeTo}
                    onChange={(e) => setComposeTo(e.target.value)}
                    placeholder={!composeTo ? "No email found" : ""}
                    className="flex-1 text-[13px] text-[#1b1b1f] placeholder:text-[#b4b5ba] focus:outline-none"
                    autoFocus={!composeTo}
                  />
                  {!composeTo && (
                    <button
                      onClick={async () => { await handleFindEmail(); }}
                      disabled={enriching}
                      className="shrink-0 flex items-center gap-1.5 rounded-md bg-[#1b1b1f] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#2c2c33] disabled:opacity-50"
                    >
                      {enriching ? (
                        <><div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />Finding...</>
                      ) : "Find Email"}
                    </button>
                  )}
                </div>
                {enrichError && !composeTo && (
                  <div className="px-5 -mt-1 pb-1"><p className="text-[11px] text-red-500">{enrichError}</p></div>
                )}
                <div className="flex items-center gap-3 px-5 py-2.5">
                  <span className="w-12 shrink-0 text-[13px] text-[#8b8d94]">Subject</span>
                  <input
                    type="text"
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    placeholder="Subject"
                    className="flex-1 text-[13px] text-[#1b1b1f] placeholder:text-[#b4b5ba] focus:outline-none"
                  />
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-5 py-3">
                <textarea
                  ref={composeBodyRef}
                  rows={12}
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  placeholder="Write your message..."
                  className="w-full resize-none text-[13px] leading-relaxed text-[#1b1b1f] placeholder:text-[#b4b5ba] focus:outline-none"
                  autoFocus={!!composeTo}
                />
                {emailSignature && (
                  <div className="mt-2 border-t border-[#f0f3f8] pt-2">
                    <div className="text-[13px] text-[#8b8d94] leading-relaxed [&_p]:m-0 [&_a]:text-[#5e6ad2] [&_a]:underline" dangerouslySetInnerHTML={{ __html: emailSignature }} />
                  </div>
                )}
              </div>

              {sendError && <div className="px-5"><p className="text-[12px] text-red-500">{sendError}</p></div>}
              {sendSuccess && <div className="px-5"><p className="text-[12px] text-[#059669]">Email sent!</p></div>}

              {/* Formatting toolbar + footer */}
              <div className="border-t border-[#e6e6e9]">
                <div className="flex items-center gap-0.5 px-4 py-2 border-b border-[#f0f3f8]">
                  <button type="button" onClick={() => execComposeFormat("**", "**")} title="Bold" className="rounded p-1.5 text-[#6b6f76] hover:bg-[#f5f5f7] hover:text-[#1b1b1f] transition-colors">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z"/></svg>
                  </button>
                  <button type="button" onClick={() => execComposeFormat("*", "*")} title="Italic" className="rounded p-1.5 text-[#6b6f76] hover:bg-[#f5f5f7] hover:text-[#1b1b1f] transition-colors">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z"/></svg>
                  </button>
                  <button type="button" onClick={() => execComposeFormat("<u>", "</u>")} title="Underline" className="rounded p-1.5 text-[#6b6f76] hover:bg-[#f5f5f7] hover:text-[#1b1b1f] transition-colors">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z"/></svg>
                  </button>
                  <button type="button" onClick={() => execComposeFormat("~~", "~~")} title="Strikethrough" className="rounded p-1.5 text-[#6b6f76] hover:bg-[#f5f5f7] hover:text-[#1b1b1f] transition-colors">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z"/></svg>
                  </button>
                  <div className="mx-1.5 h-4 w-px bg-[#e6e6e9]" />
                  <button type="button" onClick={() => execComposeFormat("\n- ", "")} title="Bullet list" className="rounded p-1.5 text-[#6b6f76] hover:bg-[#f5f5f7] hover:text-[#1b1b1f] transition-colors">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z"/></svg>
                  </button>
                  <button type="button" onClick={() => { const url = prompt("Enter URL:"); if (url) execComposeFormat("[", `](${url})`); }} title="Insert link" className="rounded p-1.5 text-[#6b6f76] hover:bg-[#f5f5f7] hover:text-[#1b1b1f] transition-colors">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>
                  </button>
                </div>
                <div className="flex items-center justify-between px-5 py-3">
                  <span />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setShowCompose(false); setSendError(""); }}
                      className="rounded-md px-3.5 py-1.5 text-[13px] font-medium text-[#6b6f76] hover:bg-[#f5f5f7] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSendEmail}
                      disabled={sending || !composeTo || !composeSubject || !composeBody}
                      className="flex items-center gap-1.5 rounded-md bg-[#1b1b1f] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#2c2c33] disabled:opacity-50 transition-colors"
                    >
                      {sending ? (
                        <><div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />Sending...</>
                      ) : (
                        <><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>Send</>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="h-8" />
      </div>
    </div>
  );
}
