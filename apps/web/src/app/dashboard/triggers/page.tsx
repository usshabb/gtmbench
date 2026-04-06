"use client";

import { useEffect, useRef, useState } from "react";
import { safeJson, apiFetch } from "../components";

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
    name: "linkedin-content",
    description: "Signals when tracked people post on LinkedIn. Optionally filter by keyword to only surface relevant posts.",
    hasKeyword: true,
    hasJobTitles: false,
  },
  {
    type: "ats_jobs",
    name: "job-listing",
    description: "Signals when tracked companies post new jobs on their ATS. Filter by job title or keyword to focus on roles that matter.",
    hasKeyword: true,
    hasJobTitles: true,
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
      className="flex min-h-[46px] flex-wrap gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 cursor-text focus-within:border-zinc-400 transition-colors"
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
/*  Trigger Card                                                        */
/* ------------------------------------------------------------------ */
function TriggerCard({
  def,
  trigger,
  isEnabled,
  isActive,
  jobTitles,
  keyword,
  enabling,
  onEnable,
  onPauseResume,
  onEditJobTitles,
  onEditKeyword,
  onDisable,
}: {
  def: (typeof TRIGGER_DEFINITIONS)[number];
  trigger: Trigger | undefined;
  isEnabled: boolean;
  isActive: boolean;
  jobTitles: string[];
  keyword: string | null | undefined;
  enabling: boolean;
  onEnable: () => void;
  onPauseResume: () => void;
  onEditJobTitles: () => void;
  onEditKeyword: () => void;
  onDisable: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="group relative flex flex-col rounded-xl border border-zinc-200 bg-white px-4 py-3 transition-all hover:border-zinc-300 hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold text-zinc-900">{def.name}</h3>
            {isEnabled && (
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                isActive ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
              }`}>
                {isActive ? "Active" : "Paused"}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400 line-clamp-2">
            {def.description}
          </p>
        </div>

        {/* 3-dot menu */}
        <div className="relative z-10 shrink-0">
          <button
            onClick={() => setShowMenu((v) => !v)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition-all hover:bg-zinc-100 hover:text-zinc-600"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-8 z-30 w-40 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
                {isEnabled ? (
                  <>
                    <button
                      onClick={() => { setShowMenu(false); onPauseResume(); }}
                      className="flex w-full items-center px-3 py-2 text-[13px] text-zinc-700 hover:bg-zinc-50 transition-colors"
                    >
                      {isActive ? "Pause" : "Resume"}
                    </button>
                    {def.hasKeyword && (
                      <button
                        onClick={() => { setShowMenu(false); onEditKeyword(); }}
                        className="flex w-full items-center px-3 py-2 text-[13px] text-zinc-700 hover:bg-zinc-50 transition-colors"
                      >
                        Edit keyword
                      </button>
                    )}
                    {def.hasJobTitles && (
                      <button
                        onClick={() => { setShowMenu(false); onEditJobTitles(); }}
                        className="flex w-full items-center px-3 py-2 text-[13px] text-zinc-700 hover:bg-zinc-50 transition-colors"
                      >
                        Edit job titles
                      </button>
                    )}
                    <button
                      onClick={() => { setShowMenu(false); onDisable(); }}
                      className="flex w-full items-center px-3 py-2 text-[13px] text-red-600 hover:bg-red-50 transition-colors"
                    >
                      Disable
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => { setShowMenu(false); onEnable(); }}
                    disabled={enabling}
                    className="flex w-full items-center px-3 py-2 text-[13px] text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50"
                  >
                    Enable
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Config pills */}
      {isEnabled && (jobTitles.length > 0 || keyword) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {jobTitles.slice(0, 3).map((t, i) => (
            <span key={i} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">{t}</span>
          ))}
          {jobTitles.length > 3 && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">+{jobTitles.length - 3} more</span>
          )}
          {keyword && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600">
              &ldquo;{keyword}&rdquo;
            </span>
          )}
        </div>
      )}
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
  const [runningJobs, setRunningJobs] = useState<Set<string>>(new Set());
  const [runningAll, setRunningAll] = useState(false);

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
      const res = await apiFetch(`${apiBaseUrl}/triggers`, { headers: { Authorization: `Bearer ${authToken}` } });
      const data = (await safeJson(res)) as { triggers: Trigger[] };
      setTriggers(data.triggers ?? []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }

  async function fetchJobs(authToken: string) {
    setJobsLoading(true);
    try {
      await apiFetch(`${apiBaseUrl}/trigger-jobs/create`, { method: "POST", headers: { Authorization: `Bearer ${authToken}` } });
      const res = await apiFetch(`${apiBaseUrl}/trigger-jobs`, { headers: { Authorization: `Bearer ${authToken}` } });
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
      const res = await apiFetch(`${apiBaseUrl}/triggers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ triggerType: type, keyword: opts.keyword || null, jobTitles: opts.jobTitles?.length ? opts.jobTitles : null }),
      });
      if (res.ok) await fetchTriggers(token);
    } finally { setEnabling(false); }
  }

  async function updateTrigger(trigger: Trigger, fields: { keyword?: string | null; jobTitles?: string[] | null; status?: "active" | "paused" }) {
    await apiFetch(`${apiBaseUrl}/triggers/${trigger._id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(fields),
    });
    await fetchTriggers(token);
  }

  async function disableTrigger(triggerId: string) {
    await apiFetch(`${apiBaseUrl}/triggers/${triggerId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    await fetchTriggers(token);
  }

  async function runJob(jobId: string) {
    setRunningJobs((prev) => new Set([...prev, jobId]));
    setJobs((prev) => prev.map((j) => j._id === jobId ? { ...j, status: "processing" as const } : j));
    try {
      const res = await apiFetch(`${apiBaseUrl}/trigger-jobs/${jobId}/run`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const data = (await safeJson(res)) as { job?: TriggerJob };
      setJobs((prev) => prev.map((j) => j._id === jobId ? { ...j, status: data.job?.status ?? "completed" } : j));
    } catch {
      setJobs((prev) => prev.map((j) => j._id === jobId ? { ...j, status: "failed" as const } : j));
    } finally {
      setRunningJobs((prev) => { const next = new Set(prev); next.delete(jobId); return next; });
    }
  }

  async function runAllJobs() {
    const pendingJobs = jobs.filter((j) => j.status === "pending" || j.status === "failed");
    if (pendingJobs.length === 0) return;
    setRunningAll(true);
    for (const job of pendingJobs) {
      await runJob(job._id);
    }
    setRunningAll(false);
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {/* Header */}
          <p className="text-[15px] text-zinc-500 leading-relaxed">
            Triggers monitor your tracked companies and people for real-time signals like new LinkedIn posts and job listings.
          </p>

          {/* Tabs */}
          <div className="mt-4">
            <div className="inline-flex rounded-lg bg-zinc-100 p-0.5">
              {(["triggers", "jobs"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1.5 text-[13px] font-medium capitalize transition-colors ${
                    activeTab === tab
                      ? "rounded-md bg-white text-zinc-900 shadow-sm"
                      : "rounded-md text-zinc-500 hover:text-zinc-700"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {/* ── Triggers tab ── */}
          {activeTab === "triggers" && (
            <div className="mt-5">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {TRIGGER_DEFINITIONS.map((def) => {
                    const trigger = getTriggerForType(def.type);
                    const isEnabled = !!trigger;
                    const isActive = trigger?.status === "active";
                    const jobTitles = trigger?.config?.jobTitles ?? [];
                    const keyword = trigger?.config?.keyword;

                    return (
                      <TriggerCard
                        key={def.type}
                        def={def}
                        trigger={trigger}
                        isEnabled={isEnabled}
                        isActive={isActive}
                        jobTitles={jobTitles}
                        keyword={keyword}
                        enabling={enabling}
                        onEnable={() => {
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
                        onPauseResume={() => updateTrigger(trigger!, { status: isActive ? "paused" : "active" })}
                        onEditJobTitles={() => { setJobTitlesModal({ triggerId: trigger!._id }); setJobTitlesInput(trigger!.config.jobTitles ?? []); }}
                        onEditKeyword={() => { setKeywordModal({ triggerId: trigger!._id, triggerType: def.type }); setKeywordInput(trigger!.config.keyword ?? ""); }}
                        onDisable={() => disableTrigger(trigger!._id)}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Jobs tab ── */}
          {activeTab === "jobs" && (
            <div className="mt-5">
              {jobsLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
                </div>
              ) : jobs.length === 0 ? (
                <div className="flex items-center justify-center py-16">
                  <p className="text-[14px] text-zinc-400">No jobs yet</p>
                </div>
              ) : (
                <>
                  {/* Run All button */}
                  {jobs.some((j) => j.status === "pending" || j.status === "failed") && (
                    <div className="mb-3 flex justify-end">
                      <button
                        onClick={runAllJobs}
                        disabled={runningAll}
                        className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[13px] font-medium text-zinc-700 transition-all hover:bg-zinc-50 disabled:opacity-50"
                      >
                        {runningAll ? (
                          <>
                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
                            Running…
                          </>
                        ) : (
                          <>
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                            </svg>
                            Run all
                          </>
                        )}
                      </button>
                    </div>
                  )}
                  <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
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
                              {job.status === "processing" && runningJobs.has(job._id) ? (
                                <div className="flex items-center gap-1.5">
                                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-blue-200 border-t-blue-500" />
                                  <span className="text-[11px] font-medium text-blue-600">processing</span>
                                </div>
                              ) : (
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                  job.status === "completed" ? "bg-emerald-50 text-emerald-700"
                                  : job.status === "failed" ? "bg-red-50 text-red-700"
                                  : job.status === "processing" ? "bg-blue-50 text-blue-700"
                                  : "bg-yellow-50 text-yellow-700"
                                }`}>
                                  {job.status}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {(job.status === "pending" || job.status === "failed") && (
                                <button
                                  onClick={() => runJob(job._id)}
                                  disabled={runningJobs.has(job._id)}
                                  className="rounded-lg border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-40"
                                >
                                  Run
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Job Titles modal (edit on existing trigger) ── */}
      {jobTitlesModal && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[18vh] backdrop-blur-[2px]"
          onClick={() => setJobTitlesModal(null)}
        >
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
                <button onClick={() => setJobTitlesModal(null)} className="rounded-lg border border-zinc-200 px-4 py-2 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50">Cancel</button>
                <button
                  onClick={async () => {
                    const trigger = triggers.find((t) => t._id === jobTitlesModal!.triggerId);
                    if (trigger) await updateTrigger(trigger, { jobTitles: jobTitlesInput.length ? jobTitlesInput : null });
                    setJobTitlesModal(null);
                  }}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
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
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
                className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 text-[13px] placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none transition-colors"
                type="text"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                placeholder="e.g. machine learning infrastructure (leave empty for all)"
                autoFocus
              />
              <p className="text-[12px] text-zinc-400">Leave blank to track all posts / jobs.</p>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => { setKeywordModal(null); setKeywordInput(""); }} className="rounded-lg border border-zinc-200 px-4 py-2 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50">Cancel</button>
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
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
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
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
                  className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 text-[13px] placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none transition-colors"
                  type="text"
                  value={enableKeyword}
                  onChange={(e) => setEnableKeyword(e.target.value)}
                  placeholder="e.g. machine learning (multi-word, searches descriptions)"
                />
                <p className="mt-1.5 text-[12px] text-zinc-400">Leave empty to match all job descriptions.</p>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setEnableModal(null)} className="rounded-lg border border-zinc-200 px-4 py-2 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50">Cancel</button>
                <button
                  onClick={async () => {
                    await enableTrigger(enableModal!.type, {
                      jobTitles: enableJobTitles.length ? enableJobTitles : null,
                      keyword: enableKeyword || null,
                    });
                    setEnableModal(null);
                  }}
                  disabled={enabling}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
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
