"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LetterAvatar, safeJson, apiFetch } from "./components";

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
  dismissed?: boolean;
}

interface ATSJobSignal {
  _id: string;
  signalType: "ats_new_job";
  companyDomain: string;
  data: ATSJobsSignalData;
  createdAt: string;
  dismissed?: boolean;
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
  fullName?: string | null;
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

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getFormattedDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
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
      // Group by when the signal was created (discovered), not job postedAt
      const dateKey = toDateKey(s.createdAt);
      addItem(dateKey, { kind: "ats_date_slice", signal: s, dateKey, jobs: s.data.jobs });
    } else {
      addItem(toDateKey(s.createdAt), { kind: "linkedin", signal: s });
    }
  }

  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([dateKey, items]) => ({ label: formatDateLabel(dateKey), dateKey, items }));
}

/* ------------------------------------------------------------------ */
/*  Week strip date filter                                              */
/* ------------------------------------------------------------------ */

function WeekStrip({
  selectedDateKey,
  onSelect,
  signalCountByDate,
}: {
  selectedDateKey: string;
  onSelect: (key: string) => void;
  signalCountByDate: Map<string, number>;
}) {
  const [weekOffset, setWeekOffset] = useState(0); // 0 = current week, -1 = last week, etc.

  const today = new Date();
  const dow = today.getDay(); // 0=Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dow + 6) % 7) + weekOffset * 7);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  const todayKey = toDateKey(today.toISOString());

  return (
    <div className="flex items-center justify-center gap-2 px-4">
      {/* Left arrow */}
      <button
        onClick={() => setWeekOffset((o) => o - 1)}
        className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
      </button>

      {/* Days */}
      <div className="flex items-end gap-1">
        {days.map((d) => {
          const key = toDateKey(d.toISOString());
          const isSelected = key === selectedDateKey;
          const isFuture = key > todayKey;
          const count = signalCountByDate.get(key) ?? 0;
          const dayName = d.toLocaleDateString("en-US", { weekday: "short" });
          const dayNum = d.getDate();

          return (
            <div key={key} className="group relative flex flex-col items-center gap-1.5">
              <span className={`text-[11px] font-medium ${isFuture ? "text-zinc-300" : "text-zinc-400"}`}>
                {dayName}
              </span>
              <button
                onClick={() => !isFuture && onSelect(key)}
                disabled={isFuture}
                className={`flex h-9 w-9 items-center justify-center rounded-full text-[15px] font-semibold transition-all ${
                  isSelected
                    ? "bg-amber-400 text-white shadow-sm"
                    : isFuture
                    ? "cursor-default text-zinc-300"
                    : count > 0
                    ? "text-red-500 hover:bg-red-50"
                    : "text-zinc-500 hover:bg-zinc-100"
                }`}
              >
                {isSelected ? (
                  <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (
                  dayNum
                )}
              </button>

              {/* Tooltip */}
              {!isFuture && (
                <div className="pointer-events-none absolute top-full z-20 mt-2 hidden -translate-x-1/2 left-1/2 group-hover:flex flex-col items-center">
                  <div className="h-2 w-2 rotate-45 bg-zinc-900 -mb-1" />
                  <div className="whitespace-nowrap rounded-xl bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white shadow-lg">
                    {count} Notification{count !== 1 ? "s" : ""}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Right arrow — disabled on current week */}
      <button
        onClick={() => setWeekOffset((o) => o + 1)}
        disabled={weekOffset >= 0}
        className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 disabled:cursor-default disabled:opacity-25"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </button>
    </div>
  );
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
/*  Person chip — photo only, name expands on hover                    */
/* ------------------------------------------------------------------ */

function PersonChip({ name, photoUrl }: { name: string; photoUrl?: string | null }) {
  return (
    <span className="group inline-flex items-center rounded-full border border-zinc-200 bg-white transition-all duration-200">
      <span className="flex h-6 w-6 shrink-0 overflow-hidden rounded-full bg-zinc-100">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt={name} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-zinc-500">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
      </span>
      <span className="max-w-0 overflow-hidden whitespace-nowrap text-[13px] font-medium text-zinc-900 transition-all duration-200 group-hover:max-w-[8rem] group-hover:pl-1.5 group-hover:pr-0.5">
        {name}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Company chip — favicon only, domain expands on hover               */
/* ------------------------------------------------------------------ */

function CompanyChip({ domain }: { domain: string }) {
  return (
    <span className="group inline-flex items-center rounded-full border border-zinc-200 bg-white transition-all duration-200">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white">
        <CompanyFavicon domain={domain} size={14} />
      </span>
      <span className="max-w-0 overflow-hidden whitespace-nowrap text-[13px] font-medium text-zinc-900 transition-all duration-200 group-hover:max-w-[8rem] group-hover:pl-1.5 group-hover:pr-0.5">
        {domain}
      </span>
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
  onRestore,
}: {
  item: LinkedinDisplayItem;
  companyDomain?: string | null;
  onEmail: () => void;
  onDismiss: () => void;
  onRestore?: () => void;
}) {
  const { signal } = item;
  const data = signal.data as LinkedinPostData;

  return (
    <div className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-200 ${onRestore ? "border-zinc-100 opacity-60" : "border-zinc-200 hover:shadow-md hover:-translate-y-0.5"}`}>
      {/* Clickable content area */}
      <a
        href={data.postUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block cursor-pointer px-5 pt-5 pb-6"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="flex flex-wrap items-center gap-1.5 text-[14px] leading-relaxed text-zinc-500">
            <PersonChip name={signal.personName} photoUrl={data.authorProfilePicture} />
            {companyDomain && (
              <>
                <span className="text-zinc-400">from</span>
                <CompanyChip domain={companyDomain} />
              </>
            )}
            <span>posted on LinkedIn</span>
            {signal.matchedKeyword && (
              <span className="inline-flex items-center rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">
                {signal.matchedKeyword}
              </span>
            )}
          </p>
          <span className="shrink-0 text-[12px] text-zinc-400">{timeAgo(data.postedAt)}</span>
        </div>
        {data.caption && (
          <p className="text-[13px] leading-relaxed text-zinc-500">
            {truncate(data.caption, 280)}
          </p>
        )}
      </a>

      {/* Bottom: action bar */}
      <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50 px-5 py-3">
        {/* Left: engagement */}
        <div className="flex items-center gap-2.5 text-[12px] text-zinc-400">
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
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2">
          {onRestore ? (
            <button
              onClick={onRestore}
              className="flex items-center rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[13px] font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50"
            >
              Restore
            </button>
          ) : (
            <>
              <button
                onClick={onDismiss}
                className="flex items-center rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[13px] font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50"
              >
                Dismiss
              </button>
              <button
                onClick={onEmail}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[13px] font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/gmail.webp" alt="Gmail" width={18} height={18} className="shrink-0 object-contain" />
                Email
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Buyer picker modal (for ATS email)                                 */
/* ------------------------------------------------------------------ */

function BuyerPickerModal({
  domain,
  jobs,
  persons,
  onSelect,
  onClose,
}: {
  domain: string;
  jobs: JobData[];
  persons: PersonInfo[];
  onSelect: (person: PersonInfo) => void;
  onClose: () => void;
}) {
  const buyers = persons.filter((p) => p.companyDomain === domain && p.workEmail);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[20vh] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <div>
            <p className="text-[15px] font-semibold text-zinc-900">Email a buyer at {domain}</p>
            {jobs.length > 0 && (
              <p className="mt-0.5 text-[12px] text-zinc-400">Re: {jobs[0].title}{jobs.length > 1 ? ` +${jobs.length - 1} more` : ""}</p>
            )}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {buyers.length === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] text-zinc-400">
            No contacts with emails found for {domain}.<br />Add people from this company first.
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {buyers.map((p) => (
              <button
                key={p._id}
                onClick={() => onSelect(p)}
                className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-zinc-50"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[13px] font-semibold text-zinc-600">
                  {(p.fullName ?? p.workEmail ?? "?").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  {p.fullName && <p className="text-[13px] font-medium text-zinc-900 truncate">{p.fullName}</p>}
                  <p className="text-[12px] text-zinc-400 truncate">{p.workEmail}</p>
                </div>
              </button>
            ))}
          </div>
        )}
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
  onRestore,
}: {
  item: ATSDateSlice;
  onEmail: () => void;
  onDismiss: () => void;
  onRestore?: () => void;
}) {
  const domain = item.signal.companyDomain;

  return (
    <div className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-200 ${onRestore ? "border-zinc-100 opacity-60" : "border-zinc-200 hover:shadow-md hover:-translate-y-0.5"}`}>
      {/* Clickable content area — links to first job's page */}
      <a
        href={item.jobs[0]?.jobUrl ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        className={`block px-5 pt-5 pb-6 ${item.jobs[0]?.jobUrl ? "cursor-pointer" : "cursor-default"}`}
        onClick={(e) => { if (!item.jobs[0]?.jobUrl) e.preventDefault(); }}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="flex flex-wrap items-center gap-1.5 text-[14px] leading-relaxed text-zinc-500">
            <CompanyChip domain={domain} />
            <span>posted {item.jobs.length} new job{item.jobs.length !== 1 ? "s" : ""}</span>
          </p>
          <span className="shrink-0 text-[12px] text-zinc-400">{timeAgo(item.signal.createdAt)}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {item.jobs.slice(0, 4).map((job, i) => (
            <div key={i} className="flex items-center gap-2 text-[13px]">
              <span className="font-medium text-zinc-700">{job.title}</span>
              {job.location && <span className="text-zinc-400">{job.location}</span>}
              {job.department && <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-500">{job.department}</span>}
            </div>
          ))}
          {item.jobs.length > 4 && (
            <span className="text-[12px] text-zinc-400">+{item.jobs.length - 4} more</span>
          )}
        </div>
      </a>

      {/* Bottom: action bar */}
      <div className="flex items-center justify-end gap-2 border-t border-zinc-100 bg-zinc-50 px-5 py-3">
        {onRestore ? (
          <button
            onClick={onRestore}
            className="flex items-center rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[13px] font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50"
          >
            Restore
          </button>
        ) : (
          <>
            <button
              onClick={onDismiss}
              className="flex items-center rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[13px] font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50"
            >
              Dismiss
            </button>
            <button
              onClick={onEmail}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[13px] font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/gmail.webp" alt="Gmail" width={18} height={18} className="shrink-0 object-contain" />
              Email
            </button>
          </>
        )}
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
  apiBaseUrl,
  authToken,
}: {
  modal: EmailModal;
  onChange: (m: EmailModal) => void;
  onSend: () => void;
  onClose: () => void;
  sending: boolean;
  error: string;
  apiBaseUrl: string;
  authToken: string;
}) {
  const [findingEmail, setFindingEmail] = useState(false);
  const [findError, setFindError] = useState("");

  async function handleFindEmail() {
    if (!modal.personId || !authToken) return;
    setFindingEmail(true);
    setFindError("");
    try {
      const res = await apiFetch(`${apiBaseUrl}/persons/${modal.personId}/find-email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = (await res.json()) as { email?: string | null; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      if (data.email) {
        onChange({ ...modal, to: data.email });
      } else {
        setFindError("No email found");
      }
    } catch (err) {
      setFindError(err instanceof Error ? err.message : "Failed to find email");
    } finally {
      setFindingEmail(false);
    }
  }
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
            {!modal.to && modal.personId && (
              <button
                onClick={handleFindEmail}
                disabled={findingEmail}
                className="shrink-0 flex items-center gap-1.5 rounded-lg bg-[#5469d4] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {findingEmail ? (
                  <><div className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />Finding...</>
                ) : "Find Email"}
              </button>
            )}
          </div>
          {findError && !modal.to && (
            <div className="px-5 -mt-1 pb-1">
              <p className="text-[11px] text-red-500">{findError}</p>
            </div>
          )}

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

  // Selected date filter (defaults to today)
  const [selectedDateKey, setSelectedDateKey] = useState(() => toDateKey(new Date().toISOString()));

  // User name for greeting
  const [userName, setUserName] = useState("");

  // Person lookup for email pre-fill
  const [persons, setPersons] = useState<PersonInfo[]>([]);

  // Email modal
  const [emailModal, setEmailModal] = useState<EmailModal | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState("");

  // Buyer picker for ATS cards
  const [buyerPickerSignal, setBuyerPickerSignal] = useState<ATSJobSignal | null>(null);

  // Dismissed signals — backed by DB
  const [dismissedSignals, setDismissedSignals] = useState<Signal[]>([]);
  const [expandedDismissed, setExpandedDismissed] = useState<Set<string>>(new Set());

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

  // Signal count per date key (for tooltip)
  const signalCountByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of signals) {
      if (s.signalType === "ats_new_job") {
        const today = toDateKey(new Date().toISOString());
        for (const job of s.data.jobs) {
          const key = job.postedAt ? toDateKey(job.postedAt) : today;
          map.set(key, (map.get(key) ?? 0) + 1);
        }
      } else {
        const key = toDateKey(s.createdAt);
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
    return map;
  }, [signals]);

  useEffect(() => {
    const t = window.localStorage.getItem(localStorageTokenKey) ?? "";
    setToken(t);

    if (t) {
      fetchInitial(t);
      // Fetch user name for greeting
      apiFetch(`${apiBaseUrl}/me`, { headers: { Authorization: `Bearer ${t}` } })
        .then((r) => safeJson<{ email: string; user?: { fullName?: string | null } }>(r))
        .then((d) => {
          const name = d.user?.fullName ?? d.email ?? "";
          setUserName(name.split(" ")[0]);
        })
        .catch(() => {});
      // Fetch persons for email lookup
      apiFetch(`${apiBaseUrl}/persons`, { headers: { Authorization: `Bearer ${t}` } })
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
        apiFetch(`${apiBaseUrl}/signals?since=${encodeURIComponent(cutoff)}&limit=200`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        apiFetch(`${apiBaseUrl}/signals?before=${encodeURIComponent(cutoff)}&limit=1`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
      ]);

      const recentData = (await safeJson(recentRes)) as { signals: Signal[]; total: number };
      const olderData = (await safeJson(olderCountRes)) as { total: number };

      const allFetched = recentData.signals ?? [];
      setSignals(allFetched.filter((s) => !s.dismissed));
      setDismissedSignals(allFetched.filter((s) => s.dismissed));
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
      const res = await apiFetch(
        `${apiBaseUrl}/signals?before=${encodeURIComponent(cutoffRef.current)}&limit=${OLDER_PAGE_SIZE}&offset=${olderOffsetRef.current}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = (await safeJson(res)) as { signals: Signal[]; total: number };
      const allNew = data.signals ?? [];
      olderOffsetRef.current += allNew.length;
      setSignals((prev) => [...prev, ...allNew.filter((s) => !s.dismissed)]);
      setDismissedSignals((prev) => [...prev, ...allNew.filter((s) => s.dismissed)]);
      setTotal((prev) => prev + allNew.length);
      setHasMore(olderOffsetRef.current < (data.total ?? 0));
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }

  async function dismissSignal(id: string) {
    const signal = signals.find((s) => s._id === id);
    await apiFetch(`${apiBaseUrl}/signals/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    setSignals((prev) => prev.filter((s) => s._id !== id));
    setTotal((prev) => prev - 1);
    if (signal) setDismissedSignals((prev) => [{ ...signal, dismissed: true }, ...prev]);
  }

  async function restoreSignal(id: string) {
    const signal = dismissedSignals.find((s) => s._id === id);
    if (!signal) return;
    await apiFetch(`${apiBaseUrl}/signals/${id}/restore`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    setDismissedSignals((prev) => prev.filter((s) => s._id !== id));
    setSignals((prev) => [{ ...signal, dismissed: false }, ...prev]);
    setTotal((prev) => prev + 1);
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
    setBuyerPickerSignal(signal);
  }

  function openEmailForBuyer(person: PersonInfo, signal: ATSJobSignal) {
    const domain = signal.data.companyDomain ?? signal.companyDomain;
    const firstJob = signal.data.jobs[0];
    setBuyerPickerSignal(null);
    setEmailError("");
    setEmailModal({
      to: person.workEmail ?? "",
      subject: firstJob
        ? `Re: ${firstJob.title} at ${domain ?? ""}`
        : `Following up on ${domain ?? ""}`,
      body: "",
      personId: person._id,
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
      const res = await apiFetch(`${apiBaseUrl}/persons/${resolvedPersonId}/emails`, {
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

  const allGroups = groupByDate(signals);
  const groups = allGroups.filter((g) => g.dateKey === selectedDateKey);

  const dismissedByDate = useMemo(() => {
    const map = new Map<string, DisplayItem[]>();
    for (const s of dismissedSignals) {
      const key = toDateKey(s.createdAt);
      if (!map.has(key)) map.set(key, []);
      if (s.signalType === "ats_new_job") {
        map.get(key)!.push({ kind: "ats_date_slice", signal: s, dateKey: key, jobs: s.data.jobs });
      } else {
        map.get(key)!.push({ kind: "linkedin", signal: s });
      }
    }
    return map;
  }, [dismissedSignals]);

  return (
    <div className="flex h-full flex-col bg-[#fafafa]">
      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Greeting header */}
        <div className="flex flex-col items-center pt-14 pb-6 text-center">
          <h1 className="text-[30px] font-bold tracking-tight text-zinc-900">
            {getGreeting()}{userName ? `, ${userName}` : ""} 👋
          </h1>
        </div>

        {/* Week date strip */}
        <div className="pb-8">
          <WeekStrip
            selectedDateKey={selectedDateKey}
            onSelect={setSelectedDateKey}
            signalCountByDate={signalCountByDate}
          />
        </div>

        {/* Feed */}
        <div className="mx-auto w-full max-w-xl px-4 pb-16">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
            </div>
          ) : (() => {
            const dismissedItems = dismissedByDate.get(selectedDateKey) ?? [];
            const isExpanded = expandedDismissed.has(selectedDateKey);

            return (
              <>
                {/* Active cards */}
                {groups.length === 0 ? (
                  dismissedItems.length === 0 && (
                    <div className="flex items-center justify-center py-16">
                      <p className="text-[14px] text-black/40">No signals for this day</p>
                    </div>
                  )
                ) : (
                  groups.map((group) => (
                    <div key={group.dateKey} className="pb-2">
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
                  ))
                )}

                {/* Dismissed divider — always shown for selectedDateKey if any dismissed */}
                {dismissedItems.length > 0 && (
                  <div className="mt-4">
                    <button
                      onClick={() => setExpandedDismissed((prev) => {
                        const next = new Set(prev);
                        if (next.has(selectedDateKey)) next.delete(selectedDateKey);
                        else next.add(selectedDateKey);
                        return next;
                      })}
                      className="group flex w-full items-center gap-3 py-1 text-left"
                    >
                      <div className="h-px flex-1 bg-zinc-200" />
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-medium text-zinc-400 group-hover:text-zinc-600 transition-colors">Dismissed</span>
                        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-zinc-200 px-1 text-[10px] font-semibold text-zinc-500 group-hover:bg-zinc-300 transition-colors">
                          {dismissedItems.length}
                        </span>
                        <svg
                          className={`h-3 w-3 text-zinc-400 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      </div>
                      <div className="h-px flex-1 bg-zinc-200" />
                    </button>

                    {isExpanded && (
                      <div className="mt-3 flex flex-col gap-3">
                        {dismissedItems.map((item, idx) => {
                          const key =
                            item.kind === "linkedin"
                              ? item.signal._id
                              : `dismissed-${item.signal._id}-${idx}`;

                          if (item.kind === "ats_date_slice") {
                            return (
                              <ATSCard
                                key={key}
                                item={item}
                                onEmail={() => {}}
                                onDismiss={() => {}}
                                onRestore={() => restoreSignal(item.signal._id)}
                              />
                            );
                          }

                          const personUrl = (item.signal.personLinkedinUrl ?? "")
                            .toLowerCase()
                            .replace(/\/$/, "");
                          const personInfo = personByLinkedinUrl.get(personUrl);

                          return (
                            <LinkedinCard
                              key={key}
                              item={item}
                              companyDomain={personInfo?.companyDomain}
                              onEmail={() => {}}
                              onDismiss={() => {}}
                              onRestore={() => restoreSignal(item.signal._id)}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Lazy load sentinel */}
                {hasMore && (
                  <div ref={sentinelRef} className="flex justify-center py-6">
                    {loadingMore && (
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#c2c7cf] border-t-[#5469d4]" />
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* Buyer picker modal for ATS cards */}
      {buyerPickerSignal && (
        <BuyerPickerModal
          domain={buyerPickerSignal.data.companyDomain ?? buyerPickerSignal.companyDomain}
          jobs={buyerPickerSignal.data.jobs}
          persons={persons}
          onSelect={(person) => openEmailForBuyer(person, buyerPickerSignal)}
          onClose={() => setBuyerPickerSignal(null)}
        />
      )}

      {/* Email compose modal */}
      {emailModal && (
        <EmailComposeModal
          modal={emailModal}
          onChange={setEmailModal}
          onSend={sendEmail}
          onClose={() => setEmailModal(null)}
          sending={emailSending}
          error={emailError}
          apiBaseUrl={apiBaseUrl}
          authToken={token}
        />
      )}
    </div>
  );
}
