"use client";

import { useEffect, useState } from "react";
import { LetterAvatar } from "./components";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

interface LinkedinPostData {
  postId: string;
  postUrl: string;
  caption: string | null;
  postedAt: string;
  authorName: string;
  authorLinkedinUrl: string;
  authorProfilePicture: string | null;
  engagement: {
    numComments: number;
    numShares: number;
    numReactions: number;
  };
  imageUrls: string[] | null;
  hasVideo: boolean;
  isReshare: boolean;
}

interface JobData {
  title: string;
  jobUrl?: string | null;
  location?: string | null;
  department?: string | null;
  postedAt?: string | null;
  companyDomain: string;
}

interface ATSJobsSignalData {
  newJobsCount: number;
  jobs: JobData[];
  companyDomain: string;
}

interface LinkedinSignal {
  _id: string;
  signalType: "linkedin_post";
  personName: string;
  personLinkedinUrl: string;
  data: LinkedinPostData;
  matchedKeyword?: string | null;
  createdAt: string;
}

interface ATSJobSignal {
  _id: string;
  signalType: "ats_new_job";
  companyDomain: string;
  data: ATSJobsSignalData;
  createdAt: string;
}

type Signal = LinkedinSignal | ATSJobSignal;

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "...";
}

export default function SignalsPage() {
  const apiBaseUrl = getApiBaseUrl();
  const [token, setToken] = useState("");
  const [signals, setSignals] = useState<Signal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = window.localStorage.getItem(localStorageTokenKey) ?? "";
    setToken(t);
    if (t) fetchSignals(t);
  }, []);

  async function fetchSignals(authToken: string) {
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/signals?limit=50`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = (await res.json()) as { signals: Signal[]; total: number };
      setSignals(data.signals ?? []);
      setTotal(data.total ?? 0);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function dismissSignal(id: string) {
    await fetch(`${apiBaseUrl}/signals/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    setSignals((prev) => prev.filter((s) => s._id !== id));
    setTotal((prev) => prev - 1);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Page header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">Signals</h1>
          <p className="text-[13px] text-zinc-500">
            Real-time buying signals from your triggers
            {total > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                {total}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
          </div>
        ) : signals.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-20">
            <div className="flex flex-col items-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100">
                <svg
                  className="h-6 w-6 text-zinc-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.348 14.651a3.75 3.75 0 010-5.303m5.304 0a3.75 3.75 0 010 5.303m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.79M12 12h.008v.007H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
                  />
                </svg>
              </div>
              <p className="text-[13px] font-medium text-zinc-600">No signals yet</p>
              <p className="mt-1 max-w-[280px] text-[12px] text-zinc-400">
                Enable triggers to start tracking activity. Signals will appear here when new LinkedIn posts are detected from your tracked people.
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {signals.map((signal) => (
              <div key={signal._id} className="flex gap-4 px-6 py-4 hover:bg-zinc-50/50 transition-colors">
                {signal.signalType === "ats_new_job" ? (
                  /* ATS New Job Signal — aggregated per company */
                  <>
                    <div className="shrink-0 flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50">
                      <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-zinc-900">
                          {signal.data.newJobsCount} new job{signal.data.newJobsCount !== 1 ? "s" : ""} posted at {signal.companyDomain}
                        </span>
                        <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">New Jobs</span>
                        <span className="text-[12px] text-zinc-400">{timeAgo(signal.createdAt)}</span>
                      </div>
                      <div className="mt-1.5 flex flex-col gap-1">
                        {signal.data.jobs.slice(0, 5).map((job, i) => (
                          <div key={i} className="flex items-center gap-2 text-[12px] text-zinc-500">
                            <span className="font-medium text-zinc-700">{job.title}</span>
                            {job.department && <span className="text-zinc-400">{job.department}</span>}
                            {job.location && <span className="text-zinc-400">{job.location}</span>}
                            {job.jobUrl && (
                              <a href={job.jobUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700">
                                View
                              </a>
                            )}
                          </div>
                        ))}
                        {signal.data.jobs.length > 5 && (
                          <span className="text-[12px] text-zinc-400">+{signal.data.jobs.length - 5} more</span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <button
                          onClick={() => dismissSignal(signal._id)}
                          className="text-[12px] text-zinc-400 hover:text-zinc-600"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  /* LinkedIn Post Signal */
                  <>
                    <div className="shrink-0">
                      <LetterAvatar name={signal.personName} size="md" src={(signal.data as LinkedinPostData).authorProfilePicture} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-zinc-900">
                          {signal.personName}
                        </span>
                        <span className="text-[12px] text-zinc-400">posted on LinkedIn</span>
                        <span className="text-[12px] text-zinc-400">{timeAgo((signal.data as LinkedinPostData).postedAt)}</span>
                        {signal.matchedKeyword && (
                          <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                            {signal.matchedKeyword}
                          </span>
                        )}
                      </div>

                      {(signal.data as LinkedinPostData).caption && (
                        <p className="mt-1 text-[13px] leading-relaxed text-zinc-600">
                          {truncate((signal.data as LinkedinPostData).caption!, 280)}
                        </p>
                      )}

                      <div className="mt-2 flex items-center gap-4 text-[12px] text-zinc-400">
                        <span className="flex items-center gap-1">
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3.75a.75.75 0 01.75-.75A2.25 2.25 0 0116.5 5.25c0 .372-.089.723-.245 1.033a3.25 3.25 0 00-.245 1.033c0 1.397.756 2.684 1.97 3.381A6.482 6.482 0 0121 16.5v.75a.75.75 0 01-.75.75H3.75a.75.75 0 01-.75-.75v-.75a6.482 6.482 0 013.02-5.803c1.214-.697 1.97-1.984 1.97-3.381a3.25 3.25 0 00-.245-1.033A2.25 2.25 0 017.5 5.25 2.25 2.25 0 019.75 3a.75.75 0 01.75.75v.582c0 .577.112 1.141.322 1.672.302.759.93 1.331 1.653 1.715a9.04 9.04 0 012.861 2.4c.498.634 1.226 1.08 2.031 1.08" />
                          </svg>
                          {(signal.data as LinkedinPostData).engagement.numReactions}
                        </span>
                        <span className="flex items-center gap-1">
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
                          </svg>
                          {(signal.data as LinkedinPostData).engagement.numComments}
                        </span>
                        <span className="flex items-center gap-1">
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                          </svg>
                          {(signal.data as LinkedinPostData).engagement.numShares}
                        </span>
                        {(signal.data as LinkedinPostData).isReshare && (
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">Reshare</span>
                        )}
                      </div>

                      <div className="mt-2 flex items-center gap-3">
                        <a
                          href={(signal.data as LinkedinPostData).postUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[12px] font-medium text-blue-600 hover:text-blue-700"
                        >
                          View Post
                        </a>
                        <a
                          href={signal.personLinkedinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[12px] font-medium text-zinc-500 hover:text-zinc-700"
                        >
                          View Profile
                        </a>
                        <button
                          onClick={() => dismissSignal(signal._id)}
                          className="text-[12px] text-zinc-400 hover:text-zinc-600"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
