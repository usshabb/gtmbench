"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LetterAvatar, safeJson } from "./components";

const localStorageTokenKey = "gtmbench-token";
const INITIAL_DAYS = 10;
const OLDER_PAGE_SIZE = 50;

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

/* ------------------------------------------------------------------ */
/*  Signal types                                                        */
/* ------------------------------------------------------------------ */

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

interface ATSDateSlice {
  kind: "ats_date_slice";
  signal: ATSJobSignal;
  dateKey: string;
  jobs: JobData[];
}

interface LinkedinDisplayItem {
  kind: "linkedin";
  signal: LinkedinSignal;
}

type DisplayItem = LinkedinDisplayItem | ATSDateSlice;

interface DateGroup {
  label: string;
  dateKey: string;
  items: DisplayItem[];
}

/* ------------------------------------------------------------------ */
/*  Person lookup                                                       */
/* ------------------------------------------------------------------ */

interface PersonInfo {
  _id: string;
  linkedinUrl: string;
  workEmail?: string;
  companyDomain?: string;
}

/* ------------------------------------------------------------------ */
/*  Email modal                                                         */
/* ------------------------------------------------------------------ */

interface EmailModal {
  to: string;
  subject: string;
  body: string;
  personId: string | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

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

function toDateKey(dateStr: string): string {
  return dateStr.slice(0, 10);
}

function formatDateLabel(dateKey: string): string {
  const today = toDateKey(new Date().toISOString());
  const yesterday = toDateKey(new Date(Date.now() - 86400000).toISOString());
  if (dateKey === today) return "Today";
  if (dateKey === yesterday) return "Yesterday";
  const d = new Date(dateKey + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function groupByDate(signals: Signal[]): DateGroup[] {
  const map = new Map<string, DisplayItem[]>();

  function addItem(dateKey: string, item: DisplayItem) {
    if (!map.has(dateKey)) map.set(dateKey, []);
    map.get(dateKey)!.push(item);
  }

  const today = toDateKey(new Date().toISOString());

  for (const s of signals) {
    if (s.signalType === "ats_new_job") {
      const byDate = new Map<string, JobData[]>();
      for (const job of s.data.jobs) {
        const dateKey = job.postedAt ? toDateKey(job.postedAt) : today;
        if (!byDate.has(dateKey)) byDate.set(dateKey, []);
        byDate.get(dateKey)!.push(job);
      }
      for (const [dateKey, jobs] of byDate) {
        addItem(dateKey, { kind: "ats_date_slice", signal: s, dateKey, jobs });
      }
    } else {
      addItem(toDateKey(s.createdAt), { kind: "linkedin", signal: s });
    }
  }

  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([dateKey, items]) => ({ label: formatDateLabel(dateKey), dateKey, items }));
}

/* ------------------------------------------------------------------ */
/*  Company favicon                                                     */
/* ------------------------------------------------------------------ */

function CompanyFavicon({ domain, size = 14 }: { domain?: string | null; size?: number }) {
  if (!domain) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=${size * 2}`}
      alt={domain}
      width={size}
      height={size}
      className="rounded-sm object-contain"
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Name chip                                                           */
/* ------------------------------------------------------------------ */

function NameChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#d9dce1] bg-white px-2 py-0.5 text-[13px] font-medium text-[#1a1f36]">
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  LinkedIn signal card                                                */
/* ------------------------------------------------------------------ */

function LinkedinCard({
  item,
  companyDomain,
  onEmail,
  onDismiss,
}: {
  item: LinkedinDisplayItem;
  companyDomain?: string | null;
  onEmail: () => void;
  onDismiss: () => void;
}) {
  const { signal } = item;
  const data = signal.data as LinkedinPostData;

  return (
    <div className="overflow-hidden rounded-2xl border border-[#e3e8ee] bg-white shadow-[0px_1px_3px_rgba(60,66,87,0.06)]">
      {/* Top: description */}
      <div className="px-5 py-4">
        <p className="text-[14px] leading-relaxed text-[#4f566b]">
          <NameChip>{signal.personName}</NameChip>
          {" "}posted on LinkedIn
          {signal.matchedKeyword && (
            <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
              {signal.matchedKeyword}
            </span>
          )}
        </p>
        {data.caption && (
          <p className="mt-2 text-[13px] leading-relaxed text-[#697386]">
            {truncate(data.caption, 220)}
          </p>
        )}
      </div>

      {/* Bottom: action bar */}
      <div className="flex items-center justify-between border-t border-[#f0f3f8] bg-[#f7fafc] px-5 py-3">
        {/* Left: avatar stack + engagement */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center">
            <LetterAvatar name={signal.personName} size="xs" src={data.authorProfilePicture} />
            {companyDomain && (
              <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center overflow-hidden rounded-full bg-white shadow ring-1 ring-white">
                <CompanyFavicon domain={companyDomain} size={10} />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2.5 text-[12px] text-[#a3acb9]">
            <span className="flex items-center gap-1">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3.75a.75.75 0 01.75-.75A2.25 2.25 0 0116.5 5.25c0 .372-.089.723-.245 1.033a3.25 3.25 0 00-.245 1.033c0 1.397.756 2.684 1.97 3.381A6.482 6.482 0 0121 16.5v.75a.75.75 0 01-.75.75H3.75a.75.75 0 01-.75-.75v-.75a6.482 6.482 0 013.02-5.803c1.214-.697 1.97-1.984 1.97-3.381a3.25 3.25 0 00-.245-1.033A2.25 2.25 0 017.5 5.25 2.25 2.25 0 019.75 3a.75.75 0 01.75.75v.582c0 .577.112 1.141.322 1.672.302.759.93 1.331 1.653 1.715a9.04 9.04 0 012.861 2.4c.498.634 1.226 1.08 2.031 1.08" />
              </svg>
              {data.engagement.numReactions}
            </span>
            <span className="flex items-center gap-1">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
              </svg>
              {data.engagement.numComments}
            </span>
            <span className="text-[#c2c7cf]">{timeAgo(data.postedAt)}</span>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onDismiss}
            className="text-[12px] text-[#a3acb9] transition-colors hover:text-[#4f566b]"
          >
            Dismiss
          </button>
          <a
            href={data.postUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] text-[#5469d4] transition-colors hover:text-[#3d52b8]"
          >
            View Post
          </a>
          <button
            onClick={onEmail}
            className="flex items-center gap-1.5 rounded-lg border border-[#d9dce1] bg-white px-3 py-1.5 text-[13px] font-medium text-[#1a1f36] shadow-[0px_1px_1px_rgba(0,0,0,0.06)] transition-colors hover:bg-[#f7fafc]"
          >
            <svg className="h-3.5 w-3.5 text-[#5469d4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
            Email
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ATS job signal card                                                 */
/* ------------------------------------------------------------------ */

function ATSCard({
  item,
  onEmail,
  onDismiss,
}: {
  item: ATSDateSlice;
  onEmail: () => void;
  onDismiss: () => void;
}) {
  const domain = item.signal.companyDomain;

  return (
    <div className="overflow-hidden rounded-2xl border border-[#e3e8ee] bg-white shadow-[0px_1px_3px_rgba(60,66,87,0.06)]">
      {/* Top: description */}
      <div className="px-5 py-4">
        <p className="text-[14px] leading-relaxed text-[#4f566b]">
          <NameChip>
            <CompanyFavicon domain={domain} size={12} />
            {domain}
          </NameChip>
          {" "}posted {item.jobs.length} new job{item.jobs.length !== 1 ? "s" : ""}
        </p>
        <div className="mt-2 flex flex-col gap-1">
          {item.jobs.slice(0, 3).map((job, i) => (
            <div key={i} className="flex items-center gap-2 text-[13px] text-[#697386]">
              <span className="font-medium text-[#4f566b]">{job.title}</span>
              {job.location && <span className="text-[#a3acb9]">{job.location}</span>}
              {job.jobUrl && (
                <a
                  href={job.jobUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#5469d4] hover:text-[#3d52b8]"
                >
                  View
                </a>
              )}
            </div>
          ))}
          {item.jobs.length > 3 && (
            <span className="text-[12px] text-[#a3acb9]">+{item.jobs.length - 3} more</span>
          )}
        </div>
      </div>

      {/* Bottom: action bar */}
      <div className="flex items-center justify-between border-t border-[#f0f3f8] bg-[#f7fafc] px-5 py-3">
        {/* Left: company icon */}
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-lg border border-[#e3e8ee] bg-white shadow-[0px_1px_1px_rgba(0,0,0,0.06)]">
            <CompanyFavicon domain={domain} size={14} />
          </div>
          <span className="text-[12px] text-[#a3acb9]">{domain}</span>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onDismiss}
            className="text-[12px] text-[#a3acb9] transition-colors hover:text-[#4f566b]"
          >
            Dismiss
          </button>
          <button
            onClick={onEmail}
            className="flex items-center gap-1.5 rounded-lg border border-[#d9dce1] bg-white px-3 py-1.5 text-[13px] font-medium text-[#1a1f36] shadow-[0px_1px_1px_rgba(0,0,0,0.06)] transition-colors hover:bg-[#f7fafc]"
          >
            <svg className="h-3.5 w-3.5 text-[#5469d4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
            Email
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Email compose modal                                                 */
/* ------------------------------------------------------------------ */

function EmailComposeModal({
  modal,
  onChange,
  onSend,
  onClose,
  sending,
  error,
}: {
  modal: EmailModal;
  onChange: (m: EmailModal) => void;
  onSend: () => void;
  onClose: () => void;
  sending: boolean;
  error: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[14vh]"
      onClick={() => !sending && onClose()}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#e3e8ee] px-5 py-4">
          <h2 className="text-[15px] font-semibold text-[#1a1f36]">Compose Email</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-[#a3acb9] transition-colors hover:bg-[#f7fafc] hover:text-[#4f566b]"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Fields */}
        <div className="flex flex-col divide-y divide-[#f0f3f8]">
          {/* To */}
          <div className="flex items-center gap-3 px-5 py-3">
            <span className="w-14 shrink-0 text-[12px] font-medium text-[#a3acb9]">To:</span>
            <input
              className="flex-1 text-[14px] text-[#1a1f36] placeholder:text-[#c2c7cf] focus:outline-none"
              value={modal.to}
              onChange={(e) => onChange({ ...modal, to: e.target.value, personId: null })}
              placeholder="recipient@company.com"
              autoFocus={!modal.to}
            />
          </div>

          {/* Subject */}
          <div className="flex items-center gap-3 px-5 py-3">
            <span className="w-14 shrink-0 text-[12px] font-medium text-[#a3acb9]">Subject:</span>
            <input
              className="flex-1 text-[14px] text-[#1a1f36] placeholder:text-[#c2c7cf] focus:outline-none"
              value={modal.subject}
              onChange={(e) => onChange({ ...modal, subject: e.target.value })}
              placeholder="Subject"
            />
          </div>

          {/* Body */}
          <div className="px-5 py-3">
            <textarea
              className="w-full resize-none text-[14px] text-[#1a1f36] placeholder:text-[#c2c7cf] focus:outline-none"
              rows={7}
              value={modal.body}
              onChange={(e) => onChange({ ...modal, body: e.target.value })}
              placeholder="Write your message..."
              autoFocus={!!modal.to}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#e3e8ee] bg-[#f7fafc] px-5 py-3">
          {error ? (
            <p className="text-[12px] text-red-600">{error}</p>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={sending}
              className="rounded-lg border border-[#d9dce1] bg-white px-4 py-1.5 text-[13px] font-medium text-[#4f566b] shadow-[0px_1px_1px_rgba(0,0,0,0.06)] transition-colors hover:bg-[#f7fafc] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onSend}
              disabled={sending || !modal.to.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-[#5469d4] px-4 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {sending ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Sending...
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                  Send
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                           */
/* ------------------------------------------------------------------ */

export default function SignalsPage() {
  const apiBaseUrl = getApiBaseUrl();
  const [token, setToken] = useState("");
  const [signals, setSignals] = useState<Signal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const olderOffsetRef = useRef(0);
  const cutoffRef = useRef("");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Person lookup for email pre-fill
  const [persons, setPersons] = useState<PersonInfo[]>([]);

  // Email modal
  const [emailModal, setEmailModal] = useState<EmailModal | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState("");

  // Lookup maps derived from persons list
  const personByLinkedinUrl = useMemo(() => {
    const map = new Map<string, PersonInfo>();
    for (const p of persons) {
      if (p.linkedinUrl) {
        map.set(p.linkedinUrl.toLowerCase().replace(/\/$/, ""), p);
      }
    }
    return map;
  }, [persons]);

  const personByDomain = useMemo(() => {
    const map = new Map<string, PersonInfo>();
    for (const p of persons) {
      if (p.companyDomain && !map.has(p.companyDomain)) {
        map.set(p.companyDomain, p);
      }
    }
    return map;
  }, [persons]);

  useEffect(() => {
    const t = window.localStorage.getItem(localStorageTokenKey) ?? "";
    setToken(t);
    if (t) {
      fetchInitial(t);
      // Fetch persons for email lookup
      fetch(`${apiBaseUrl}/persons`, { headers: { Authorization: `Bearer ${t}` } })
        .then((r) => safeJson<{ persons: PersonInfo[] }>(r))
        .then((d) => setPersons(d.persons ?? []))
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasMore || loadingMore) return;

    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { threshold: 0.1 }
    );

    if (sentinelRef.current) observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loadingMore, token]);

  async function fetchInitial(authToken: string) {
    setLoading(true);
    const cutoff = new Date(Date.now() - INITIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    cutoffRef.current = cutoff;
    olderOffsetRef.current = 0;

    try {
      const [recentRes, olderCountRes] = await Promise.all([
        fetch(`${apiBaseUrl}/signals?since=${encodeURIComponent(cutoff)}&limit=200`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        fetch(`${apiBaseUrl}/signals?before=${encodeURIComponent(cutoff)}&limit=1`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
      ]);

      const recentData = (await safeJson(recentRes)) as { signals: Signal[]; total: number };
      const olderData = (await safeJson(olderCountRes)) as { total: number };

      setSignals(recentData.signals ?? []);
      setTotal(recentData.total ?? 0);
      setHasMore((olderData.total ?? 0) > 0);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (loadingMore || !token) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `${apiBaseUrl}/signals?before=${encodeURIComponent(cutoffRef.current)}&limit=${OLDER_PAGE_SIZE}&offset=${olderOffsetRef.current}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = (await safeJson(res)) as { signals: Signal[]; total: number };
      const newSignals = data.signals ?? [];
      olderOffsetRef.current += newSignals.length;
      setSignals((prev) => [...prev, ...newSignals]);
      setTotal((prev) => prev + newSignals.length);
      setHasMore(olderOffsetRef.current < (data.total ?? 0));
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
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

  function openEmailForLinkedin(signal: LinkedinSignal) {
    const url = (signal.personLinkedinUrl ?? "").toLowerCase().replace(/\/$/, "");
    const person = personByLinkedinUrl.get(url);
    setEmailError("");
    setEmailModal({
      to: person?.workEmail ?? "",
      subject: `Following up re: your recent post`,
      body: "",
      personId: person?._id ?? null,
    });
  }

  function openEmailForATS(signal: ATSJobSignal) {
    const domain = signal.data.companyDomain ?? signal.companyDomain;
    const person = domain ? personByDomain.get(domain) : undefined;
    const firstJob = signal.data.jobs[0];
    setEmailError("");
    setEmailModal({
      to: person?.workEmail ?? "",
      subject: firstJob
        ? `Re: ${firstJob.title} at ${domain ?? ""}`
        : `Following up on ${domain ?? ""}`,
      body: "",
      personId: person?._id ?? null,
    });
  }

  async function sendEmail() {
    if (!emailModal) return;
    const { to, subject, body } = emailModal;

    if (!to.trim()) {
      setEmailError("Please enter a recipient email.");
      return;
    }

    setEmailSending(true);
    setEmailError("");

    // Resolve person ID: use provided, or find by email match
    let resolvedPersonId = emailModal.personId;
    if (!resolvedPersonId) {
      const matched = persons.find(
        (p) => p.workEmail?.toLowerCase() === to.toLowerCase()
      );
      resolvedPersonId = matched?._id ?? null;
    }

    if (!resolvedPersonId) {
      setEmailError("No matching person found. Add this contact to People first.");
      setEmailSending(false);
      return;
    }

    try {
      const res = await fetch(`${apiBaseUrl}/persons/${resolvedPersonId}/emails`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ to, subject, body }),
      });
      const data = (await safeJson(res)) as { success?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to send");
      setEmailModal(null);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setEmailSending(false);
    }
  }

  const groups = groupByDate(signals);

  return (
    <div className="flex h-full flex-col bg-[#f7fafc]">
      {/* Page header */}
      <div className="flex items-center justify-between border-b border-[#e3e8ee] bg-white px-6 py-4">
        <div>
          <h1 className="text-[16px] font-semibold text-[#1a1f36]">Signals</h1>
          <p className="text-[13px] text-[#697386]">
            Real-time buying signals from your triggers
            {total > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-[#f0f3f8] px-2 py-0.5 text-[11px] font-medium text-[#697386]">
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
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#c2c7cf] border-t-[#5469d4]" />
          </div>
        ) : signals.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-24">
            <div className="flex flex-col items-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[#eef0f8]">
                <svg className="h-6 w-6 text-[#5469d4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.651a3.75 3.75 0 010-5.303m5.304 0a3.75 3.75 0 010 5.303m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.79M12 12h.008v.007H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
              </div>
              <p className="text-[14px] font-medium text-[#1a1f36]">No signals yet</p>
              <p className="mt-1 max-w-[280px] text-[13px] text-[#697386]">
                Enable triggers to start tracking activity. Signals appear when new LinkedIn posts or jobs are detected.
              </p>
            </div>
          </div>
        ) : (
          <>
            {groups.map((group) => (
              <div key={group.dateKey} className="px-6 pb-2">
                {/* Date label */}
                <div className="flex items-center gap-2 py-4">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#a3acb9]">
                    {group.label}
                  </span>
                  <span className="text-[11px] text-[#c2c7cf]">
                    {group.items.length} signal{group.items.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex flex-col gap-3">
                  {group.items.map((item, idx) => {
                    const key =
                      item.kind === "linkedin"
                        ? item.signal._id
                        : `${item.signal._id}-${item.dateKey}-${idx}`;

                    if (item.kind === "ats_date_slice") {
                      return (
                        <ATSCard
                          key={key}
                          item={item}
                          onEmail={() => openEmailForATS(item.signal)}
                          onDismiss={() => dismissSignal(item.signal._id)}
                        />
                      );
                    }

                    // LinkedIn signal — look up company domain from persons map
                    const personUrl = (item.signal.personLinkedinUrl ?? "")
                      .toLowerCase()
                      .replace(/\/$/, "");
                    const personInfo = personByLinkedinUrl.get(personUrl);

                    return (
                      <LinkedinCard
                        key={key}
                        item={item}
                        companyDomain={personInfo?.companyDomain}
                        onEmail={() => openEmailForLinkedin(item.signal)}
                        onDismiss={() => dismissSignal(item.signal._id)}
                      />
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Lazy load sentinel */}
            {hasMore && (
              <div ref={sentinelRef} className="flex justify-center py-6">
                {loadingMore && (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#c2c7cf] border-t-[#5469d4]" />
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Email compose modal */}
      {emailModal && (
        <EmailComposeModal
          modal={emailModal}
          onChange={setEmailModal}
          onSend={sendEmail}
          onClose={() => setEmailModal(null)}
          sending={emailSending}
          error={emailError}
        />
      )}
    </div>
  );
}
