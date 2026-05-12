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

interface RunResult {
  ran: number;
  totalSignals?: number;
  startupsFound?: number;
  newCount?: number;
  signalsCreated?: number;
  message?: string;
  failures?: { linkedinUrl?: string; domain?: string; error: string }[];
}

const TRIGGER_DEFINITIONS = [
  {
    type: "linkedin_content",
    name: "linkedin-content",
    description: "Signals when tracked people post on LinkedIn. Optionally filter by keyword to only surface relevant posts.",
    hasKeyword: true,
    hasJobTitles: false,
    runEndpoint: "/run/linkedin-content",
  },
  {
    type: "ats_jobs",
    name: "job-listing",
    description: "Signals when tracked companies post new jobs on their ATS. Filter by job title or keyword to focus on roles that matter.",
    hasKeyword: true,
    hasJobTitles: true,
    runEndpoint: "/run/ats-jobs",
  },
  {
    type: "recently_funded",
    name: "Recently Funded Startup",
    description: "Signals when US startups receive funding. Searches for new funding rounds and enriches each company with Fiber.",
    hasKeyword: false,
    hasJobTitles: false,
    runEndpoint: "/run/recently-funded",
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
      className="flex min-h-[46px] flex-wrap gap-1.5 rounded-md border border-[#e6e6e9] bg-white px-3 py-2 cursor-text focus-within:border-zinc-400 transition-colors"
      onClick={() => inputRef.current?.focus()}
    >
      {titles.map((t, i) => (
        <span key={i} className="inline-flex items-center gap-1 rounded-md bg-[#f5f5f7] pl-2.5 pr-1.5 py-0.5 text-[12px] font-medium text-[#6b6f76]">
          {t}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(titles.filter((_, idx) => idx !== i)); }}
            className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[#8b8d94] hover:text-[#6b6f76]"
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
        className="min-w-[120px] flex-1 bg-transparent text-[13px] text-[#1b1b1f] placeholder:text-[#8b8d94] outline-none"
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
  running,
  lastResult,
  onEnable,
  onPauseResume,
  onEditJobTitles,
  onEditKeyword,
  onDisable,
  onRun,
}: {
  def: (typeof TRIGGER_DEFINITIONS)[number];
  trigger: Trigger | undefined;
  isEnabled: boolean;
  isActive: boolean;
  jobTitles: string[];
  keyword: string | null | undefined;
  enabling: boolean;
  running: boolean;
  lastResult: RunResult | null;
  onEnable: () => void;
  onPauseResume: () => void;
  onEditJobTitles: () => void;
  onEditKeyword: () => void;
  onDisable: () => void;
  onRun: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="group relative flex flex-col rounded-lg border border-[#e6e6e9] bg-white px-3.5 py-2.5 transition-all hover:border-[#d4d4d8]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-medium text-[#1b1b1f]">{def.name}</h3>
            {isEnabled && (
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                isActive ? "bg-[#ecfdf5] text-[#059669]" : "bg-[#fffbeb] text-[#d97706]"
              }`}>
                {isActive ? "Active" : "Paused"}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[#8b8d94] line-clamp-2">
            {def.description}
          </p>
        </div>

        {/* 3-dot menu */}
        <div className="relative z-10 shrink-0">
          <button
            onClick={() => setShowMenu((v) => !v)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-[#8b8d94] transition-all hover:bg-[#f5f5f7] hover:text-[#6b6f76]"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-8 z-30 w-40 rounded-md border border-[#e6e6e9] bg-white py-1 shadow-lg">
                {isEnabled ? (
                  <>
                    <button
                      onClick={() => { setShowMenu(false); onPauseResume(); }}
                      className="flex w-full items-center px-3 py-2 text-[13px] text-[#6b6f76] hover:bg-[#f9f9fb] transition-colors"
                    >
                      {isActive ? "Pause" : "Resume"}
                    </button>
                    {def.hasKeyword && (
                      <button
                        onClick={() => { setShowMenu(false); onEditKeyword(); }}
                        className="flex w-full items-center px-3 py-2 text-[13px] text-[#6b6f76] hover:bg-[#f9f9fb] transition-colors"
                      >
                        Edit keyword
                      </button>
                    )}
                    {def.hasJobTitles && (
                      <button
                        onClick={() => { setShowMenu(false); onEditJobTitles(); }}
                        className="flex w-full items-center px-3 py-2 text-[13px] text-[#6b6f76] hover:bg-[#f9f9fb] transition-colors"
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
                    className="flex w-full items-center px-3 py-2 text-[13px] text-[#6b6f76] hover:bg-[#f9f9fb] transition-colors disabled:opacity-50"
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
            <span key={i} className="rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[11px] font-medium text-[#6b6f76]">{t}</span>
          ))}
          {jobTitles.length > 3 && (
            <span className="rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[11px] font-medium text-[#6b6f76]">+{jobTitles.length - 3} more</span>
          )}
          {keyword && (
            <span className="rounded-full bg-[#eef0ff] px-2 py-0.5 text-[11px] font-medium text-[#5e6ad2]">
              &ldquo;{keyword}&rdquo;
            </span>
          )}
        </div>
      )}

      {/* Run button + last-result line */}
      {isEnabled && isActive && (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#f1f1f3] pt-2.5">
          <div className="min-w-0 flex-1 text-[11px] text-[#8b8d94]">
            {running ? (
              <span className="flex items-center gap-1.5">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
                Running…
              </span>
            ) : lastResult ? (
              <span title={lastResult.message ?? ""}>
                Last run: {lastResult.ran} item(s)
                {typeof lastResult.totalSignals === "number" && ` · ${lastResult.totalSignals} signals`}
                {typeof lastResult.signalsCreated === "number" && ` · ${lastResult.signalsCreated} signals`}
                {lastResult.failures && lastResult.failures.length > 0 && ` · ${lastResult.failures.length} fail`}
              </span>
            ) : (
              <span>Never run</span>
            )}
          </div>
          <button
            onClick={onRun}
            disabled={running}
            className="rounded-md border border-[#e6e6e9] bg-white px-2.5 py-1 text-[11px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f9f9fb] disabled:opacity-50"
          >
            {running ? "Running…" : "Run now"}
          </button>
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

  // Run state — per trigger type
  const [runningType, setRunningType] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<Record<string, RunResult>>({});
  const [runningAll, setRunningAll] = useState(false);

  useEffect(() => {
    const t = window.localStorage.getItem(localStorageTokenKey) ?? "";
    setToken(t);
    if (t) fetchTriggers(t);
  }, []);

  async function fetchTriggers(authToken: string) {
    setLoading(true);
    console.log("[triggers] GET /triggers");
    try {
      const res = await apiFetch(`${apiBaseUrl}/triggers`, { headers: { Authorization: `Bearer ${authToken}` } });
      const data = (await safeJson(res)) as { triggers: Trigger[] };
      setTriggers(data.triggers ?? []);
      console.log(`[triggers] loaded ${data.triggers?.length ?? 0} trigger(s)`);
    } catch (err) {
      console.error("[triggers] fetch failed", err);
    } finally {
      setLoading(false);
    }
  }

  function getTriggerForType(type: string): Trigger | undefined {
    return triggers.find((s) => s.triggerType === type);
  }

  async function enableTrigger(type: string, opts: { keyword?: string | null; jobTitles?: string[] | null } = {}) {
    setEnabling(true);
    console.log(`[triggers] POST /triggers type=${type}`, opts);
    try {
      const res = await apiFetch(`${apiBaseUrl}/triggers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ triggerType: type, keyword: opts.keyword || null, jobTitles: opts.jobTitles?.length ? opts.jobTitles : null }),
      });
      if (res.ok) await fetchTriggers(token);
      else console.error(`[triggers] enable failed status=${res.status}`);
    } finally { setEnabling(false); }
  }

  async function updateTrigger(trigger: Trigger, fields: { keyword?: string | null; jobTitles?: string[] | null; status?: "active" | "paused" }) {
    console.log(`[triggers] PUT /triggers/${trigger._id}`, fields);
    await apiFetch(`${apiBaseUrl}/triggers/${trigger._id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(fields),
    });
    await fetchTriggers(token);
  }

  async function disableTrigger(triggerId: string) {
    console.log(`[triggers] DELETE /triggers/${triggerId}`);
    await apiFetch(`${apiBaseUrl}/triggers/${triggerId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    await fetchTriggers(token);
  }

  async function runTrigger(def: (typeof TRIGGER_DEFINITIONS)[number]): Promise<RunResult> {
    const url = `${apiBaseUrl}${def.runEndpoint}`;
    console.log(`[run] POST ${def.runEndpoint} (${def.type})`);
    const started = Date.now();
    try {
      const res = await apiFetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const result = (await safeJson(res)) as RunResult;
      const ms = Date.now() - started;
      console.log(`[run] ${def.type} done in ${ms}ms:`, result);
      return result;
    } catch (err) {
      const ms = Date.now() - started;
      console.error(`[run] ${def.type} failed after ${ms}ms`, err);
      return { ran: 0, totalSignals: 0, message: err instanceof Error ? err.message : "Run failed" };
    }
  }

  async function handleRun(def: (typeof TRIGGER_DEFINITIONS)[number]) {
    setRunningType(def.type);
    const result = await runTrigger(def);
    setLastResults((prev) => ({ ...prev, [def.type]: result }));
    setRunningType(null);
  }

  async function handleRunAll() {
    setRunningAll(true);
    const activeDefs = TRIGGER_DEFINITIONS.filter((d) => {
      const t = getTriggerForType(d.type);
      return t && t.status === "active";
    });
    console.log(`[run] run-all starting for ${activeDefs.length} active trigger(s)`);
    for (const def of activeDefs) {
      setRunningType(def.type);
      const result = await runTrigger(def);
      setLastResults((prev) => ({ ...prev, [def.type]: result }));
    }
    setRunningType(null);
    setRunningAll(false);
    console.log("[run] run-all done");
  }

  const hasActive = triggers.some((t) => t.status === "active");

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          <div className="flex items-start justify-between gap-3">
            <p className="flex-1 text-[13px] text-[#6b6f76] leading-relaxed">
              Triggers monitor your tracked companies and people for real-time signals like new LinkedIn posts and job listings. Use &ldquo;Run now&rdquo; to fetch fresh signals on demand.
            </p>
            {hasActive && (
              <button
                onClick={handleRunAll}
                disabled={runningAll}
                className="shrink-0 flex items-center gap-1.5 rounded-md border border-[#e6e6e9] bg-white px-3 py-1.5 text-[13px] font-medium text-[#6b6f76] transition-all hover:bg-[#f5f5f7] disabled:opacity-50"
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
            )}
          </div>

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
                  const lastResult = lastResults[def.type] ?? null;

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
                      running={runningType === def.type}
                      lastResult={lastResult}
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
                      onRun={() => handleRun(def)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Job Titles modal (edit on existing trigger) ── */}
      {jobTitlesModal && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[18vh] backdrop-blur-[2px]"
          onClick={() => setJobTitlesModal(null)}
        >
          <div className="w-full max-w-md rounded-lg bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-6 pb-4">
              <div>
                <h2 className="text-[17px] font-bold text-[#1b1b1f]">Job Title Filter</h2>
                <p className="mt-0.5 text-[12px] text-[#8b8d94]">Only signal jobs matching these titles</p>
              </div>
              <button onClick={() => setJobTitlesModal(null)} className="flex h-8 w-8 items-center justify-center rounded-full text-[#8b8d94] hover:bg-[#f5f5f7] transition-colors">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-6 pb-6 space-y-3">
              <JobTitlesInput
                titles={jobTitlesInput}
                onChange={setJobTitlesInput}
                placeholder="Software Engineer, Product Manager…"
              />
              <p className="text-[12px] text-[#8b8d94]">Press Enter or comma to add · Backspace to remove last · Leave empty to track all titles</p>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setJobTitlesModal(null)} className="rounded-md border border-[#e6e6e9] px-4 py-2 text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f9f9fb]">Cancel</button>
                <button
                  onClick={async () => {
                    const trigger = triggers.find((t) => t._id === jobTitlesModal!.triggerId);
                    if (trigger) await updateTrigger(trigger, { jobTitles: jobTitlesInput.length ? jobTitlesInput : null });
                    setJobTitlesModal(null);
                  }}
                  className="rounded-md bg-[#1b1b1f] px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
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
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[18vh] backdrop-blur-[2px]"
          onClick={() => { setKeywordModal(null); setKeywordInput(""); }}
        >
          <div className="w-full max-w-md rounded-lg bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-6 pb-4">
              <div>
                <h2 className="text-[17px] font-bold text-[#1b1b1f]">Keyword Filter</h2>
                <p className="mt-0.5 text-[12px] text-[#8b8d94]">Multi-word search across job descriptions</p>
              </div>
              <button onClick={() => { setKeywordModal(null); setKeywordInput(""); }} className="flex h-8 w-8 items-center justify-center rounded-full text-[#8b8d94] hover:bg-[#f5f5f7] transition-colors">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-6 pb-6 space-y-3">
              <input
                className="w-full rounded-md border border-[#e6e6e9] bg-white px-4 py-3 text-[13px] placeholder:text-[#8b8d94] focus:border-zinc-400 focus:outline-none transition-colors"
                type="text"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                placeholder="e.g. machine learning infrastructure (leave empty for all)"
                autoFocus
              />
              <p className="text-[12px] text-[#8b8d94]">Leave blank to track all posts / jobs.</p>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => { setKeywordModal(null); setKeywordInput(""); }} className="rounded-md border border-[#e6e6e9] px-4 py-2 text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f9f9fb]">Cancel</button>
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
                  className="rounded-md bg-[#1b1b1f] px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
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
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[12vh] backdrop-blur-[2px]"
          onClick={() => setEnableModal(null)}
        >
          <div className="w-full max-w-md rounded-lg bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-6 pb-5">
              <div>
                <h2 className="text-[17px] font-bold text-[#1b1b1f]">Enable Job Listing</h2>
                <p className="mt-0.5 text-[12px] text-[#8b8d94]">Configure filters before activating</p>
              </div>
              <button onClick={() => setEnableModal(null)} className="flex h-8 w-8 items-center justify-center rounded-full text-[#8b8d94] hover:bg-[#f5f5f7] transition-colors">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="px-6 pb-6 space-y-5">
              {/* Job titles */}
              <div>
                <label className="block text-[13px] font-semibold text-[#1b1b1f] mb-1.5">Job Title Filter <span className="font-normal text-[#8b8d94]">(optional)</span></label>
                <JobTitlesInput
                  titles={enableJobTitles}
                  onChange={setEnableJobTitles}
                  placeholder="Software Engineer, Product Manager…"
                />
                <p className="mt-1.5 text-[12px] text-[#8b8d94]">Press Enter or comma to add. Leave empty to track all titles.</p>
              </div>

              {/* Keyword */}
              <div>
                <label className="block text-[13px] font-semibold text-[#1b1b1f] mb-1.5">Keyword Filter <span className="font-normal text-[#8b8d94]">(optional)</span></label>
                <input
                  className="w-full rounded-md border border-[#e6e6e9] bg-white px-4 py-3 text-[13px] placeholder:text-[#8b8d94] focus:border-zinc-400 focus:outline-none transition-colors"
                  type="text"
                  value={enableKeyword}
                  onChange={(e) => setEnableKeyword(e.target.value)}
                  placeholder="e.g. machine learning (multi-word, searches descriptions)"
                />
                <p className="mt-1.5 text-[12px] text-[#8b8d94]">Leave empty to match all job descriptions.</p>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setEnableModal(null)} className="rounded-md border border-[#e6e6e9] px-4 py-2 text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f9f9fb]">Cancel</button>
                <button
                  onClick={async () => {
                    await enableTrigger(enableModal!.type, {
                      jobTitles: enableJobTitles.length ? enableJobTitles : null,
                      keyword: enableKeyword || null,
                    });
                    setEnableModal(null);
                  }}
                  disabled={enabling}
                  className="rounded-md bg-[#1b1b1f] px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
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
