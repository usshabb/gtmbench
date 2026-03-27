"use client";

import { useEffect, useRef, useState } from "react";
import { safeJson } from "../components";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

interface Trigger {
  _id: string;
  triggerType: string;
  config: { keyword?: string | null; jobTitles?: string[] | null };
  status: "active" | "paused";
  createdAt: string;
  updatedAt: string;
}

interface TriggerJob {
  _id: string;
  triggerId: string;
  userEmail: string;
  jobType: "LinkedinPost" | "ATSJobs";
  personId?: string;
  linkedinUrl?: string;
  atsUrl?: string;
  domain?: string;
  status: "pending" | "processing" | "completed" | "failed";
  lastProcessedAt?: string;
  error?: string;
  createdAt: string;
}

const TRIGGER_DEFINITIONS = [
  {
    type: "linkedin_content",
    name: "LinkedIn Content",
    tagline: "Signals when tracked people post on LinkedIn",
    hasKeyword: true,
    hasJobTitles: false,
    icon: (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
  {
    type: "ats_jobs",
    name: "Job Listing",
    tagline: "Signals when tracked companies post new jobs",
    hasKeyword: true,
    hasJobTitles: true,
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
      </svg>
    ),
  },
];

/* ------------------------------------------------------------------ */
/*  Tag input for job titles                                            */
/* ------------------------------------------------------------------ */
function JobTitlesInput({
  titles,
  onChange,
  placeholder,
}: {
  titles: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function commit(raw: string) {
    const parts = raw.split(",").map((t) => t.trim()).filter(Boolean);
    if (parts.length === 0) return;
    onChange([...titles, ...parts.filter((p) => !titles.includes(p))]);
    setInputValue("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(inputValue); }
    else if (e.key === "Backspace" && inputValue === "" && titles.length > 0) {
      onChange(titles.slice(0, -1));
    }
  }

  return (
    <div
      className="flex min-h-[46px] flex-wrap gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 cursor-text focus-within:border-zinc-400 transition-colors"
      onClick={() => inputRef.current?.focus()}
    >
      {titles.map((t, i) => (
        <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 pl-2.5 pr-1.5 py-0.5 text-[12px] font-medium text-zinc-700">
          {t}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(titles.filter((_, idx) => idx !== i)); }}
            className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-zinc-400 hover:text-zinc-600"
          >
            <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => commit(inputValue)}
        placeholder={titles.length === 0 ? (placeholder ?? "Add title…") : "Add title…"}
        className="min-w-[120px] flex-1 bg-transparent text-[13px] text-zinc-900 placeholder:text-zinc-400 outline-none"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                           */
/* ------------------------------------------------------------------ */
export default function TriggersPage() {
  const apiBaseUrl = getApiBaseUrl();
  const [token, setToken] = useState("");
  const [activeTab, setActiveTab] = useState<"triggers" | "jobs">("triggers");

  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabling, setEnabling] = useState(false);

  // Keyword modal
  const [keywordModal, setKeywordModal] = useState<{ triggerId: string; triggerType: string } | null>(null);
  const [keywordInput, setKeywordInput] = useState("");

  // Job Titles modal
  const [jobTitlesModal, setJobTitlesModal] = useState<{ triggerId: string } | null>(null);
  const [jobTitlesInput, setJobTitlesInput] = useState<string[]>([]);

  // Enable modal (for ats_jobs — configure before enabling)
  const [enableModal, setEnableModal] = useState<{ type: string } | null>(null);
  const [enableJobTitles, setEnableJobTitles] = useState<string[]>([]);
  const [enableKeyword, setEnableKeyword] = useState("");

  const [jobs, setJobs] = useState<TriggerJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);

  useEffect(() => {
    const t = window.localStorage.getItem(localStorageTokenKey) ?? "";
    setToken(t);
    if (t) fetchTriggers(t);
  }, []);

  useEffect(() => {
    if (token && activeTab === "jobs") fetchJobs(token);
  }, [activeTab, token]);

  async function fetchTriggers(authToken: string) {
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/triggers`, { headers: { Authorization: `Bearer ${authToken}` } });
      const data = (await safeJson(res)) as { triggers: Trigger[] };
      setTriggers(data.triggers ?? []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }

  async function fetchJobs(authToken: string) {
    setJobsLoading(true);
    try {
      await fetch(`${apiBaseUrl}/trigger-jobs/create`, { method: "POST", headers: { Authorization: `Bearer ${authToken}` } });
      const res = await fetch(`${apiBaseUrl}/trigger-jobs`, { headers: { Authorization: `Bearer ${authToken}` } });
      const data = (await safeJson(res)) as { jobs: TriggerJob[] };
      setJobs(data.jobs ?? []);
    } catch { /* ignore */ } finally { setJobsLoading(false); }
  }

  function getTriggerForType(type: string): Trigger | undefined {
    return triggers.find((s) => s.triggerType === type);
  }

  async function enableTrigger(type: string, opts: { keyword?: string | null; jobTitles?: string[] | null } = {}) {
    setEnabling(true);
    try {
      const res = await fetch(`${apiBaseUrl}/triggers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ triggerType: type, keyword: opts.keyword || null, jobTitles: opts.jobTitles?.length ? opts.jobTitles : null }),
      });
      if (res.ok) await fetchTriggers(token);
    } finally { setEnabling(false); }
  }

  async function updateTrigger(trigger: Trigger, fields: { keyword?: string | null; jobTitles?: string[] | null; status?: "active" | "paused" }) {
    await fetch(`${apiBaseUrl}/triggers/${trigger._id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(fields),
    });
    await fetchTriggers(token);
  }

  async function disableTrigger(triggerId: string) {
    await fetch(`${apiBaseUrl}/triggers/${triggerId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    await fetchTriggers(token);
  }

  async function runJob(jobId: string) {
    setRunningJobId(jobId);
    try {
      await fetch(`${apiBaseUrl}/trigger-jobs/${jobId}/run`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      await fetchJobs(token);
    } finally { setRunningJobId(null); }
  }

  return (
    <div className="flex h-full flex-col bg-[#f8f8f7]">

      {/* Tabs */}
      <div className="flex border-b border-zinc-200 bg-[#f8f8f7] px-6 pt-1">
        {(["triggers", "jobs"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`border-b-2 pb-2.5 pt-2 text-[13px] font-medium capitalize transition-colors mr-3 ${
              activeTab === tab ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-400 hover:text-zinc-600"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[800px] px-4 py-6">

        {/* ── Triggers tab ── */}
        {activeTab === "triggers" && (
          loading ? (
            <div className="flex h-full items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {TRIGGER_DEFINITIONS.map((def) => {
                const trigger = getTriggerForType(def.type);
                const isEnabled = !!trigger;
                const isActive = trigger?.status === "active";
                const jobTitles = trigger?.config?.jobTitles ?? [];
                const keyword = trigger?.config?.keyword;

                return (
                  <div
                    key={def.type}
                    className={`group flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition-all hover:shadow-md ${isEnabled ? "border-zinc-300" : "border-zinc-200"}`}
                  >
                    {/* Icon area */}
                    <div className="relative flex h-28 items-end bg-cover bg-center px-4 pb-4" style={{ backgroundImage: "url('/card-header.webp')" }}>
                      <div className="absolute inset-0 rounded-t-2xl bg-black/30" />
                      <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-white backdrop-blur-sm border border-white/20">
                        {def.icon}
                      </div>
                      {isEnabled && (
                        <span className={`absolute top-3 right-3 rounded-full px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm ${isActive ? "bg-emerald-400/25 text-emerald-200 border border-emerald-400/30" : "bg-yellow-400/25 text-yellow-200 border border-yellow-400/30"}`}>
                          {isActive ? "Active" : "Paused"}
                        </span>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex flex-1 flex-col px-4 pt-3 pb-4">
                      <h3 className="text-[14px] font-bold text-zinc-900">{def.name}</h3>
                      <p className="mt-0.5 text-[12px] text-zinc-400">{def.tagline}</p>

                      {/* Badges: job titles + keyword */}
                      {isEnabled && (jobTitles.length > 0 || keyword) && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {jobTitles.slice(0, 3).map((t, i) => (
                            <span key={i} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">{t}</span>
                          ))}
                          {jobTitles.length > 3 && (
                            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">+{jobTitles.length - 3} more</span>
                          )}
                          {keyword && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600">
                              &ldquo;{keyword}&rdquo;
                              <button onClick={() => updateTrigger(trigger!, { keyword: null })} className="text-blue-400 hover:text-blue-600">&times;</button>
                            </span>
                          )}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {isEnabled ? (
                          <>
                            <button
                              onClick={() => updateTrigger(trigger!, { status: isActive ? "paused" : "active" })}
                              className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${isActive ? "border-yellow-200 text-yellow-700 hover:bg-yellow-50" : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"}`}
                            >
                              {isActive ? "Pause" : "Resume"}
                            </button>
                            {def.hasJobTitles && (
                              <button
                                onClick={() => { setJobTitlesModal({ triggerId: trigger!._id }); setJobTitlesInput(trigger!.config.jobTitles ?? []); }}
                                className="rounded-lg border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
                              >
                                Job Titles
                              </button>
                            )}
                            {def.hasKeyword && (
                              <button
                                onClick={() => { setKeywordModal({ triggerId: trigger!._id, triggerType: def.type }); setKeywordInput(trigger!.config.keyword ?? ""); }}
                                className="rounded-lg border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
                              >
                                Keyword
                              </button>
                            )}
                            <button
                              onClick={() => disableTrigger(trigger!._id)}
                              className="rounded-lg border border-red-100 px-2.5 py-1 text-[11px] font-medium text-red-500 transition-colors hover:bg-red-50"
                            >
                              Disable
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => {
                              if (def.hasJobTitles) {
                                setEnableJobTitles([]);
                                setEnableKeyword("");
                                setEnableModal({ type: def.type });
                              } else if (def.hasKeyword) {
                                setKeywordModal({ triggerId: def.type, triggerType: def.type });
                                setKeywordInput("");
                              } else {
                                void enableTrigger(def.type);
                              }
                            }}
                            disabled={enabling}
                            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                          >
                            {enabling ? "Enabling…" : "Enable"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* ── Jobs tab ── */}
        {activeTab === "jobs" && (
          jobsLoading ? (
            <div className="flex h-full items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-[13px] text-zinc-400">No jobs yet</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-zinc-100 bg-zinc-50">
                    <th className="px-4 py-3 text-left text-[12px] font-medium text-zinc-400">Type</th>
                    <th className="px-4 py-3 text-left text-[12px] font-medium text-zinc-400">Target</th>
                    <th className="px-4 py-3 text-left text-[12px] font-medium text-zinc-400">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {jobs.map((job) => (
                    <tr key={job._id} className="hover:bg-zinc-50/80">
                      <td className="px-4 py-3 text-zinc-700">
                        {job.jobType === "LinkedinPost" ? "LinkedIn" : "Job Listing"}
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3 text-zinc-400">
                        {job.jobType === "LinkedinPost"
                          ? (job.linkedinUrl?.replace("https://www.linkedin.com/in/", "") ?? "—")
                          : (job.domain ?? "—")}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          job.status === "completed" ? "bg-emerald-50 text-emerald-700"
                          : job.status === "failed" ? "bg-red-50 text-red-700"
                          : job.status === "processing" ? "bg-blue-50 text-blue-700"
                          : "bg-yellow-50 text-yellow-700"
                        }`}>
                          {job.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {(job.status === "pending" || job.status === "failed") && (
                          <button
                            onClick={() => runJob(job._id)}
                            disabled={runningJobId === job._id}
                            className="rounded-lg border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-40"
                          >
                            {runningJobId === job._id ? "Running…" : "Run"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        </div>
      </div>

      {/* ── Job Titles modal (edit on existing trigger) ── */}
      {jobTitlesModal && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[18vh] backdrop-blur-[2px]"
          onClick={() => setJobTitlesModal(null)}
        >
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-6 pb-4">
              <div>
                <h2 className="text-[17px] font-bold text-zinc-900">Job Title Filter</h2>
                <p className="mt-0.5 text-[12px] text-zinc-400">Only signal jobs matching these titles</p>
              </div>
              <button onClick={() => setJobTitlesModal(null)} className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 transition-colors">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-6 pb-6 space-y-3">
              <JobTitlesInput
                titles={jobTitlesInput}
                onChange={setJobTitlesInput}
                placeholder="Software Engineer, Product Manager…"
              />
              <p className="text-[12px] text-zinc-400">Press Enter or comma to add · Backspace to remove last · Leave empty to track all titles</p>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setJobTitlesModal(null)} className="rounded-xl border border-zinc-200 px-4 py-2 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50">Cancel</button>
                <button
                  onClick={async () => {
                    const trigger = triggers.find((t) => t._id === jobTitlesModal!.triggerId);
                    if (trigger) await updateTrigger(trigger, { jobTitles: jobTitlesInput.length ? jobTitlesInput : null });
                    setJobTitlesModal(null);
                  }}
                  className="rounded-xl bg-zinc-900 px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Keyword modal ── */}
      {keywordModal && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[18vh] backdrop-blur-[2px]"
          onClick={() => { setKeywordModal(null); setKeywordInput(""); }}
        >
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-6 pb-4">
              <div>
                <h2 className="text-[17px] font-bold text-zinc-900">Keyword Filter</h2>
                <p className="mt-0.5 text-[12px] text-zinc-400">Multi-word search across job descriptions</p>
              </div>
              <button onClick={() => { setKeywordModal(null); setKeywordInput(""); }} className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 transition-colors">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-6 pb-6 space-y-3">
              <input
                className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[13px] placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none transition-colors"
                type="text"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                placeholder="e.g. machine learning infrastructure (leave empty for all)"
                autoFocus
              />
              <p className="text-[12px] text-zinc-400">Leave blank to track all posts / jobs.</p>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => { setKeywordModal(null); setKeywordInput(""); }} className="rounded-xl border border-zinc-200 px-4 py-2 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50">Cancel</button>
                <button
                  onClick={async () => {
                    const existing = getTriggerForType(keywordModal!.triggerType);
                    if (existing && keywordModal!.triggerId === existing._id) {
                      await updateTrigger(existing, { keyword: keywordInput || null });
                    } else {
                      // Enabling linkedin_content via keyword modal
                      await enableTrigger(keywordModal!.triggerType, { keyword: keywordInput || null });
                    }
                    setKeywordModal(null); setKeywordInput("");
                  }}
                  disabled={enabling}
                  className="rounded-xl bg-zinc-900 px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {enabling ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Enable Job Listing modal (configure filters before enabling) ── */}
      {enableModal && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-[2px]"
          onClick={() => setEnableModal(null)}
        >
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-6 pb-5">
              <div>
                <h2 className="text-[17px] font-bold text-zinc-900">Enable Job Listing</h2>
                <p className="mt-0.5 text-[12px] text-zinc-400">Configure filters before activating</p>
              </div>
              <button onClick={() => setEnableModal(null)} className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 transition-colors">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="px-6 pb-6 space-y-5">
              {/* Job titles */}
              <div>
                <label className="block text-[13px] font-semibold text-zinc-900 mb-1.5">Job Title Filter <span className="font-normal text-zinc-400">(optional)</span></label>
                <JobTitlesInput
                  titles={enableJobTitles}
                  onChange={setEnableJobTitles}
                  placeholder="Software Engineer, Product Manager…"
                />
                <p className="mt-1.5 text-[12px] text-zinc-400">Press Enter or comma to add. Leave empty to track all titles.</p>
              </div>

              {/* Keyword */}
              <div>
                <label className="block text-[13px] font-semibold text-zinc-900 mb-1.5">Keyword Filter <span className="font-normal text-zinc-400">(optional)</span></label>
                <input
                  className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[13px] placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none transition-colors"
                  type="text"
                  value={enableKeyword}
                  onChange={(e) => setEnableKeyword(e.target.value)}
                  placeholder="e.g. machine learning (multi-word, searches descriptions)"
                />
                <p className="mt-1.5 text-[12px] text-zinc-400">Leave empty to match all job descriptions.</p>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setEnableModal(null)} className="rounded-xl border border-zinc-200 px-4 py-2 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50">Cancel</button>
                <button
                  onClick={async () => {
                    await enableTrigger(enableModal!.type, {
                      jobTitles: enableJobTitles.length ? enableJobTitles : null,
                      keyword: enableKeyword || null,
                    });
                    setEnableModal(null);
                  }}
                  disabled={enabling}
                  className="rounded-xl bg-zinc-900 px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {enabling ? "Enabling…" : "Enable"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
