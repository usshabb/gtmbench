"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { LetterAvatar, safeJson, dispatchDataChanged, apiFetch } from "../../components";

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
        <div className="relative flex items-center gap-4 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
          <LetterAvatar name={fullName} size="lg" src={photoUrl} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[16px] font-bold text-zinc-900">{fullName}</h1>
              {person.enrichmentStatus !== "completed" && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${person.enrichmentStatus === "failed" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"}`}>
                  {person.enrichmentStatus}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-zinc-400">
              {title && company && <span>{title} at {company}</span>}
              {title && company && location && <span>·</span>}
              {location && <span>{location}</span>}
            </div>
            {/* Pills */}
            <div className="mt-2 flex flex-wrap gap-2">
              {linkedinSlug && (
                <a href={person.linkedinUrl} target="_blank" rel="noopener noreferrer" className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-0.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 transition-colors">LinkedIn</a>
              )}
              {personEmail ? (
                <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-0.5 text-[11px] font-medium text-zinc-600">{personEmail}</span>
              ) : (
                <button
                  onClick={() => void handleFindEmail()}
                  disabled={enriching}
                  className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-0.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 transition-colors disabled:opacity-50"
                >
                  {enriching ? "Finding..." : "Find Email"}
                </button>
              )}
              {data?.open_to_work && (
                <span className="rounded-full bg-emerald-50 px-3 py-0.5 text-[11px] font-medium text-emerald-700">Open to work</span>
              )}
              {data?.is_hiring && (
                <span className="rounded-full bg-blue-50 px-3 py-0.5 text-[11px] font-medium text-blue-700">Hiring</span>
              )}
            </div>
          </div>
          {/* 3-dot menu */}
          <div className="relative self-start">
            <button
              onClick={() => setShowMenu((v) => !v)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition-all hover:bg-zinc-100 hover:text-zinc-600"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-8 z-30 w-36 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
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
        <div className="mt-4 flex gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-lg px-4 py-1.5 text-[13px] font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-zinc-200 text-zinc-900"
                  : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
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
                className="mt-6 flex items-center gap-4 rounded-xl border border-zinc-200 bg-white px-5 py-4 transition-colors hover:border-zinc-200"
              >
                <LetterAvatar name={companyName as string ?? "?"} size="md" rounded="lg" src={companyLogo} />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Current Company</p>
                  <p className="text-sm font-semibold text-zinc-900">{companyName}</p>
                  {companyIndustry && <p className="text-xs text-zinc-500">{companyIndustry}</p>}
                </div>
              </Link>
            )}

            {/* Bio + Details card */}
            {(bio || infoItems.length > 0) && (
              <div className="mt-6 rounded-xl border border-zinc-200 bg-white">
                {bio && (
                  <div className={`px-5 py-4${infoItems.length > 0 ? " border-b border-zinc-200" : ""}`}>
                    <p className="text-sm leading-relaxed text-zinc-600">{bio}</p>
                  </div>
                )}
                {infoItems.length > 0 && (
                  <div className="px-4 py-3 flex flex-wrap gap-2">
                    {infoItems.map((item) => (
                      <span key={item.label} className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-[12px]">
                        <span className="text-zinc-400">{item.label}</span>
                        <span className="ml-1.5 font-semibold text-zinc-800">{item.value}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Skills */}
            {skills && skills.length > 0 && (
              <div className="mt-6 rounded-xl border border-zinc-200 bg-white">
                <div className="px-4 py-3 border-b border-zinc-200">
                  <h2 className="text-[13px] font-semibold text-zinc-700">Skills</h2>
                </div>
                <div className="px-4 py-3 flex flex-wrap gap-1.5">
                  {skills.slice(0, 15).map((skill) => (
                    <span key={skill} className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">{skill}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : activeTab === "experience" ? (
          <div>
            {/* Experience */}
            {experiences && experiences.length > 0 && (
              <div className="mt-6 rounded-xl border border-zinc-200 bg-white">
                <div className="px-4 py-3 border-b border-zinc-200">
                  <h2 className="text-[13px] font-semibold text-zinc-700">Experience</h2>
                </div>
                <div className="px-4 py-3">
                  <div className="relative">
                    {experiences.slice(0, 8).map((exp, i) => (
                      <div key={i} className="flex items-start gap-3 pb-3 last:pb-0">
                        <div className="flex flex-col items-center pt-1.5">
                          <div className={`h-2 w-2 rounded-full shrink-0 ${exp.is_current ? "bg-emerald-400" : "bg-zinc-300"}`} />
                          {i < Math.min((experiences?.length ?? 0), 8) - 1 && <div className="w-px flex-1 bg-zinc-200 mt-1" style={{ minHeight: 20 }} />}
                        </div>
                        <div className="flex flex-1 items-start justify-between min-w-0">
                          <div>
                            <span className="text-[13px] font-medium text-zinc-800">{exp.title}</span>
                            {exp.company_name && <span className="ml-1 text-[13px] text-zinc-500">at {exp.company_name}</span>}
                            {exp.is_current && <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">Current</span>}
                          </div>
                          <span className="ml-2 shrink-0 text-[11px] text-zinc-400">
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
              <div className="mt-6 rounded-xl border border-zinc-200 bg-white">
                <div className="px-4 py-3 border-b border-zinc-200">
                  <h2 className="text-[13px] font-semibold text-zinc-700">Education</h2>
                </div>
                <div className="divide-y divide-zinc-100">
                  {education.slice(0, 4).map((edu, i) => (
                    <div key={i} className="px-4 py-3 text-sm">
                      <span className="font-medium text-zinc-800">{edu.school_name}</span>
                      {(edu.degree || edu.field_of_study_name) && (
                        <span className="ml-1 text-zinc-500">— {[edu.degree, edu.field_of_study_name].filter(Boolean).join(", ")}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(!experiences || experiences.length === 0) && (!education || education.length === 0) && (
              <div className="mt-6 flex flex-col items-center justify-center py-16 text-center">
                <p className="text-[13px] text-zinc-400">No experience or education data available.</p>
              </div>
            )}
          </div>
        ) : (
          /* Email tab */
          <div className="mt-6">
            {/* Email actions */}
            <div className="rounded-xl border border-zinc-200 bg-white">
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200">
                <h2 className="text-[13px] font-semibold text-zinc-700">Email</h2>
                <div className="flex items-center gap-2">
                  {gmailConnected && (
                    <button
                      onClick={() => { setShowCompose(true); if (personEmail) setComposeTo(personEmail); }}
                      className="flex items-center gap-1.5 rounded-[10px] border border-zinc-200 px-2.5 py-1 text-[12px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                      Compose
                    </button>
                  )}
                  {gmailConnected && personEmail && !emailsLoading && (
                    <button
                      onClick={() => loadEmails(personEmail)}
                      className="text-[11px] text-zinc-400 hover:text-zinc-600"
                    >
                      Refresh
                    </button>
                  )}
                </div>
              </div>

              {!gmailConnected && (
                <div className="px-5 py-6 text-center">
                  <p className="text-[13px] text-zinc-500 mb-3">Connect Gmail to see email history and send emails.</p>
                  <button
                    onClick={connectGmail}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-[13px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>
                    Connect Gmail
                  </button>
                </div>
              )}

              {gmailConnected && !personEmail && (
                <div className="px-5 py-5">
                  <p className="mb-1 text-[13px] font-medium text-zinc-700">No email address found.</p>
                  <p className="mb-4 text-[12px] text-zinc-400">Find their email via Fiber, or add it manually.</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void handleFindEmail()}
                      disabled={enriching}
                      className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
                    >
                      {enriching && !showManualEmail ? (
                        <><div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />Finding email...</>
                      ) : "Find Email"}
                    </button>
                    <button
                      onClick={() => { setShowManualEmail((v) => !v); setEnrichError(""); }}
                      className="text-[12px] text-zinc-400 hover:text-zinc-600 underline"
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
                        className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[13px] text-zinc-800 outline-none focus:border-zinc-300 focus:bg-white"
                        onKeyDown={(e) => { if (e.key === "Enter") void handleSetManualEmail(); }}
                      />
                      <button
                        onClick={() => void handleSetManualEmail()}
                        disabled={enriching || !manualEmailInput.trim()}
                        className="rounded-lg border border-zinc-200 px-3 py-2 text-[12px] font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
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
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
                </div>
              )}

              {gmailConnected && personEmail && !emailsLoading && emails.length === 0 && (
                <div className="px-5 py-6 text-center">
                  <p className="text-[13px] text-zinc-400">No emails found with this person.</p>
                </div>
              )}

              {emails.length > 0 && (
                <div className="divide-y divide-zinc-100">
                  {emails.map((email) => (
                    <div key={email.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-[13px] font-medium text-zinc-800 truncate">{email.subject}</p>
                        <span className="shrink-0 text-[11px] text-zinc-400">
                          {email.date ? new Date(email.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-zinc-400 truncate">
                        {email.from.includes(personEmail) ? `From: ${email.from}` : `To: ${email.to}`}
                      </p>
                      {email.snippet && (
                        <p className="mt-1 text-[12px] leading-relaxed text-zinc-500 line-clamp-2">{email.snippet}</p>
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
                <h3 className="text-[14px] font-semibold text-zinc-900">New Email</h3>
                <button onClick={() => { setShowCompose(false); setSendError(""); setSendSuccess(false); }} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="px-5 py-4 space-y-3">
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">To</label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="email"
                      value={composeTo}
                      onChange={(e) => setComposeTo(e.target.value)}
                      placeholder={!composeTo ? "No email found" : ""}
                      className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[13px] text-zinc-800 outline-none focus:border-zinc-300 focus:bg-white"
                    />
                    {!composeTo && (
                      <button
                        onClick={async () => {
                          await handleFindEmail();
                          // After finding, personEmail will update via setPerson — set composeTo
                        }}
                        disabled={enriching}
                        className="shrink-0 flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-[12px] font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
                      >
                        {enriching ? (
                          <><div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />Finding...</>
                        ) : "Find Email"}
                      </button>
                    )}
                  </div>
                  {enrichError && !composeTo && <p className="mt-1 text-[11px] text-red-500">{enrichError}</p>}
                </div>
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Subject</label>
                  <input
                    type="text"
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[13px] text-zinc-800 outline-none focus:border-zinc-300 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Message</label>
                  <textarea
                    rows={6}
                    value={composeBody}
                    onChange={(e) => setComposeBody(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[13px] text-zinc-800 outline-none focus:border-zinc-300 focus:bg-white resize-none"
                  />
                </div>
                {sendError && <p className="text-[12px] text-red-500">{sendError}</p>}
                {sendSuccess && <p className="text-[12px] text-emerald-600">Email sent!</p>}
              </div>
              <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-4">
                <button
                  onClick={() => { setShowCompose(false); setSendError(""); }}
                  className="rounded-lg px-4 py-2 text-[13px] text-zinc-500 hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendEmail}
                  disabled={sending || !composeTo || !composeSubject || !composeBody}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
                >
                  {sending ? "Sending..." : "Send"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="h-8" />
      </div>
    </div>
  );
}
