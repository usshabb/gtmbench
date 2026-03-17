"use client";

import { useEffect, useState } from "react";
import { safeJson } from "../components";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

interface Trigger {
  _id: string;
  triggerType: string;
  config: { keyword?: string | null };
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
  leadId?: string;
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
    description:
      "Track LinkedIn posts from people in your list. When a new post is detected (< 24h old), it becomes a signal. Optionally filter by keyword.",
    hasKeyword: true,
    icon: (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
  {
    type: "ats_jobs",
    name: "ATS Job Listings",
    description:
      "Track job postings from companies in your companies list. When a new job is posted in the last 24 hours, it becomes a signal. Requires ATS detection to be run on your companies.",
    hasKeyword: false,
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
      </svg>
    ),
  },
];


export default function TriggersPage() {
  const apiBaseUrl = getApiBaseUrl();
  const [token, setToken] = useState("");
  const [activeTab, setActiveTab] = useState<"triggers" | "jobs">("triggers");

  // Triggers state
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabling, setEnabling] = useState(false);
  const [keywordInput, setKeywordInput] = useState("");
  const [showKeywordModal, setShowKeywordModal] = useState<string | null>(null);

  // Jobs state
  const [jobs, setJobs] = useState<TriggerJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [creatingJobs, setCreatingJobs] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);

  useEffect(() => {
    const t = window.localStorage.getItem(localStorageTokenKey) ?? "";
    setToken(t);
    if (t) fetchTriggers(t);
  }, []);

  useEffect(() => {
    if (token && activeTab === "jobs") {
      fetchJobs(token);
    }
  }, [activeTab, token]);

  async function fetchTriggers(authToken: string) {
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/triggers`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = (await safeJson(res)) as { triggers: Trigger[] };
      setTriggers(data.triggers ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function fetchJobs(authToken: string) {
    setJobsLoading(true);
    try {
      // Sync/create any missing trigger jobs first
      await fetch(`${apiBaseUrl}/trigger-jobs/create`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const res = await fetch(`${apiBaseUrl}/trigger-jobs`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = (await safeJson(res)) as { jobs: TriggerJob[] };
      setJobs(data.jobs ?? []);
    } catch {
      // ignore
    } finally {
      setJobsLoading(false);
    }
  }

  function getTriggerForType(type: string): Trigger | undefined {
    return triggers.find((s) => s.triggerType === type);
  }

  async function enableTrigger(type: string, keyword: string | null) {
    setEnabling(true);
    try {
      const res = await fetch(`${apiBaseUrl}/triggers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ triggerType: type, keyword: keyword || null }),
      });
      if (res.ok) {
        await fetchTriggers(token);
      }
    } finally {
      setEnabling(false);
      setShowKeywordModal(null);
      setKeywordInput("");
    }
  }

  async function toggleTriggerStatus(trigger: Trigger) {
    const newStatus = trigger.status === "active" ? "paused" : "active";
    await fetch(`${apiBaseUrl}/triggers/${trigger._id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: newStatus }),
    });
    await fetchTriggers(token);
  }

  async function updateKeyword(trigger: Trigger, keyword: string | null) {
    await fetch(`${apiBaseUrl}/triggers/${trigger._id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ keyword }),
    });
    await fetchTriggers(token);
  }

  async function disableTrigger(triggerId: string) {
    await fetch(`${apiBaseUrl}/triggers/${triggerId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    await fetchTriggers(token);
  }

  async function createJobs() {
    setCreatingJobs(true);
    try {
      await fetch(`${apiBaseUrl}/trigger-jobs/create`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchJobs(token);
    } finally {
      setCreatingJobs(false);
    }
  }

  async function runAllJobs() {
    setRunningAll(true);
    try {
      await fetch(`${apiBaseUrl}/trigger-jobs/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchJobs(token);
    } finally {
      setRunningAll(false);
    }
  }

  async function runJob(jobId: string) {
    setRunningJobId(jobId);
    try {
      await fetch(`${apiBaseUrl}/trigger-jobs/${jobId}/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchJobs(token);
    } finally {
      setRunningJobId(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Page header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">Triggers</h1>
          <p className="text-[13px] text-zinc-500">
            Enable triggers to automatically track activity and generate signals
          </p>
        </div>
        {activeTab === "jobs" && (
          <div className="flex items-center gap-2">
            <button
              onClick={createJobs}
              disabled={creatingJobs}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50"
            >
              {creatingJobs ? "Creating..." : "Create Jobs"}
            </button>
            <button
              onClick={runAllJobs}
              disabled={runningAll}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {runningAll ? "Running..." : "Run All"}
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-200 px-6">
        {(["triggers", "jobs"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`mr-4 border-b-2 py-2.5 text-[13px] font-medium capitalize transition-colors ${
              activeTab === tab
                ? "border-zinc-900 text-zinc-900"
                : "border-transparent text-zinc-400 hover:text-zinc-600"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === "triggers" && (
          <>
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
              </div>
            ) : (
              <div className="space-y-4">
                {TRIGGER_DEFINITIONS.map((def) => {
                  const trigger = getTriggerForType(def.type);
                  const isEnabled = !!trigger;

                  return (
                    <div key={def.type} className="rounded-xl border border-zinc-200 bg-white p-5">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-4">
                          <div
                            className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                              isEnabled ? "bg-blue-50 text-blue-600" : "bg-zinc-100 text-zinc-400"
                            }`}
                          >
                            {def.icon}
                          </div>
                          <div>
                            <h3 className="text-[15px] font-semibold text-zinc-900">{def.name}</h3>
                            <p className="mt-0.5 max-w-md text-[13px] text-zinc-500">{def.description}</p>

                            {trigger && (
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <span
                                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                    trigger.status === "active"
                                      ? "bg-green-50 text-green-700"
                                      : "bg-yellow-50 text-yellow-700"
                                  }`}
                                >
                                  {trigger.status === "active" ? "Active" : "Paused"}
                                </span>
                                {def.hasKeyword && trigger.config.keyword && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                                    Keyword: &quot;{trigger.config.keyword}&quot;
                                    <button
                                      onClick={() => updateKeyword(trigger, null)}
                                      className="ml-0.5 text-zinc-400 hover:text-zinc-600"
                                    >
                                      &times;
                                    </button>
                                  </span>
                                )}
                                {def.hasKeyword && !trigger.config.keyword && (
                                  <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500">
                                    All posts tracked
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {isEnabled ? (
                            <>
                              <button
                                onClick={() => toggleTriggerStatus(trigger!)}
                                className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                                  trigger!.status === "active"
                                    ? "border-yellow-200 text-yellow-700 hover:bg-yellow-50"
                                    : "border-green-200 text-green-700 hover:bg-green-50"
                                }`}
                              >
                                {trigger!.status === "active" ? "Pause" : "Resume"}
                              </button>
                              {def.hasKeyword && (
                                <button
                                  onClick={() => {
                                    setShowKeywordModal(trigger!._id);
                                    setKeywordInput(trigger!.config.keyword ?? "");
                                  }}
                                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
                                >
                                  Edit Keyword
                                </button>
                              )}
                              <button
                                onClick={() => disableTrigger(trigger!._id)}
                                className="rounded-lg border border-red-200 px-3 py-1.5 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-50"
                              >
                                Disable
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() =>
                                def.hasKeyword ? setShowKeywordModal(def.type) : enableTrigger(def.type, null)
                              }
                              disabled={enabling}
                              className="rounded-lg bg-zinc-900 px-4 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                            >
                              {enabling ? "Enabling..." : "Enable"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {activeTab === "jobs" && (
          <>
            {jobsLoading ? (
              <div className="flex justify-center py-12">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
              </div>
            ) : jobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-[14px] font-medium text-zinc-500">No jobs</p>
                <p className="mt-1 text-[13px] text-zinc-400">
                  Click &ldquo;Create Jobs&rdquo; to generate jobs for your active triggers.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-zinc-100 bg-zinc-50">
                      <th className="px-4 py-3 text-left font-medium text-zinc-500">Type</th>
                      <th className="px-4 py-3 text-left font-medium text-zinc-500">Target</th>
                      <th className="px-4 py-3 text-left font-medium text-zinc-500">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {jobs.map((job) => (
                      <tr key={job._id} className="hover:bg-zinc-50">
                        <td className="px-4 py-3 text-zinc-700">
                          {job.jobType === "LinkedinPost" ? "LinkedIn Post" : "ATS Jobs"}
                        </td>
                        <td className="max-w-[220px] truncate px-4 py-3 text-zinc-500">
                          {job.jobType === "LinkedinPost"
                            ? (job.linkedinUrl?.replace("https://www.linkedin.com/in/", "") ?? "—")
                            : (job.domain ?? "—")}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              job.status === "completed"
                                ? "bg-green-50 text-green-700"
                                : job.status === "failed"
                                  ? "bg-red-50 text-red-700"
                                  : job.status === "processing"
                                    ? "bg-blue-50 text-blue-700"
                                    : "bg-yellow-50 text-yellow-700"
                            }`}
                          >
                            {job.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {(job.status === "pending" || job.status === "failed") && (
                            <button
                              onClick={() => runJob(job._id)}
                              disabled={runningJobId === job._id || job.status === "processing"}
                              className="rounded-lg border border-zinc-200 px-2.5 py-1 text-[12px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-40"
                            >
                              {runningJobId === job._id ? "Running..." : "Run"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* Keyword modal */}
      {showKeywordModal && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[20vh]"
          onClick={() => {
            setShowKeywordModal(null);
            setKeywordInput("");
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
              <h2 className="text-[15px] font-semibold text-zinc-900">
                {getTriggerForType("linkedin_content") &&
                showKeywordModal === getTriggerForType("linkedin_content")?._id
                  ? "Update Keyword Filter"
                  : "Enable LinkedIn Content Tracking"}
              </h2>
              <button
                onClick={() => {
                  setShowKeywordModal(null);
                  setKeywordInput("");
                }}
                className="rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5">
              <label className="mb-1.5 block text-[13px] font-medium text-zinc-700">
                Keyword Filter (optional)
              </label>
              <input
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px] placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
                type="text"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                placeholder="e.g. hiring, funding, launch (leave empty for all posts)"
                autoFocus
              />
              <p className="mt-1.5 text-[12px] text-zinc-400">
                If set, only posts containing this keyword will appear as signals. Leave blank to track all posts.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowKeywordModal(null);
                    setKeywordInput("");
                  }}
                  className="rounded-lg border border-zinc-200 px-4 py-2 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    const existingTrigger = getTriggerForType("linkedin_content");
                    if (existingTrigger && showKeywordModal === existingTrigger._id) {
                      await updateKeyword(existingTrigger, keywordInput || null);
                      setShowKeywordModal(null);
                      setKeywordInput("");
                    } else {
                      await enableTrigger("linkedin_content", keywordInput || null);
                    }
                  }}
                  disabled={enabling}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {enabling ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
