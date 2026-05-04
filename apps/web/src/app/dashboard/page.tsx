"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LetterAvatar, safeJson, apiFetch, FallbackImg } from "./components";

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

interface FundedStartupItem {
  companyName: string;
  websiteDomain: string;
  fundingAmount: string;
  investors: string[];
  citationUrl?: string;
  enrichmentData?: Record<string, unknown>;
}

interface FundedStartupSignalData {
  startups: FundedStartupItem[];
  fetchedDate: string;
}

interface FundedStartupSignal {
  _id: string;
  signalType: "recently_funded";
  data: FundedStartupSignalData;
  createdAt: string;
  dismissed?: boolean;
}

type Signal = LinkedinSignal | ATSJobSignal | FundedStartupSignal;

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

interface FundedStartupDisplayItem {
  kind: "funded_startup";
  signal: FundedStartupSignal;
}

type DisplayItem = LinkedinDisplayItem | ATSDateSlice | FundedStartupDisplayItem;

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
  availableEmails?: { email: string; type: string }[];
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
  availableEmails?: { email: string; type: string }[];
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
      const dateKey = toDateKey(s.createdAt);
      addItem(dateKey, { kind: "ats_date_slice", signal: s, dateKey, jobs: s.data.jobs });
    } else if (s.signalType === "recently_funded") {
      addItem(toDateKey(s.createdAt), { kind: "funded_startup", signal: s });
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
        className="flex h-7 w-7 items-center justify-center rounded-full text-[#8b8d94] transition-colors hover:bg-[#f5f5f7] hover:text-[#6b6f76]"
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
              <span className={`text-[11px] font-medium ${isFuture ? "text-[#8b8d94]" : "text-[#8b8d94]"}`}>
                {dayName}
              </span>
              <button
                onClick={() => !isFuture && onSelect(key)}
                disabled={isFuture}
                className={`flex h-9 w-9 items-center justify-center rounded-full text-[15px] font-medium transition-all ${
                  isSelected
                    ? "bg-amber-400 text-white"
                    : isFuture
                    ? "cursor-default text-[#8b8d94]"
                    : count > 0
                    ? "text-red-500 hover:bg-red-50"
                    : "text-[#6b6f76] hover:bg-[#f5f5f7]"
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
                  <div className="h-2 w-2 rotate-45 bg-[#1b1b1f] -mb-1" />
                  <div className="whitespace-nowrap rounded-md bg-[#1b1b1f] px-3 py-1.5 text-[12px] font-medium text-white shadow-lg">
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
        className="flex h-7 w-7 items-center justify-center rounded-full text-[#8b8d94] transition-colors hover:bg-[#f5f5f7] hover:text-[#6b6f76] disabled:cursor-default disabled:opacity-25"
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
    <span className="group inline-flex items-center rounded-full border border-[#e6e6e9] bg-white transition-all duration-200">
      <span className="flex h-6 w-6 shrink-0 overflow-hidden rounded-full bg-[#f5f5f7]">
        <FallbackImg src={photoUrl} alt={name} className="h-full w-full object-cover">
          <span className="flex h-full w-full items-center justify-center text-[10px] font-medium text-[#6b6f76]">
            {name.charAt(0).toUpperCase()}
          </span>
        </FallbackImg>
      </span>
      <span className="max-w-0 overflow-hidden whitespace-nowrap text-[13px] font-medium text-[#1b1b1f] transition-all duration-200 group-hover:max-w-[8rem] group-hover:pl-1.5 group-hover:pr-0.5">
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
    <span className="group inline-flex items-center rounded-full border border-[#e6e6e9] bg-white transition-all duration-200">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white">
        <CompanyFavicon domain={domain} size={14} />
      </span>
      <span className="max-w-0 overflow-hidden whitespace-nowrap text-[13px] font-medium text-[#1b1b1f] transition-all duration-200 group-hover:max-w-[8rem] group-hover:pl-1.5 group-hover:pr-0.5">
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
    <div className={`overflow-hidden rounded-lg border bg-white transition-all duration-200 ${onRestore ? "border-[#ededf0] opacity-60" : "border-[#e6e6e9]"}`}>
      {/* Clickable content area */}
      <a
        href={data.postUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block cursor-pointer px-4 pt-4 pb-5"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="flex flex-wrap items-center gap-1.5 text-[14px] leading-relaxed text-[#6b6f76]">
            <PersonChip name={signal.personName} photoUrl={data.authorProfilePicture} />
            {companyDomain && (
              <>
                <span className="text-[#8b8d94]">from</span>
                <CompanyChip domain={companyDomain} />
              </>
            )}
            <span>posted on LinkedIn</span>
            {signal.matchedKeyword && (
              <span className="inline-flex items-center rounded-md bg-[#f5f5f7] px-1.5 py-0.5 text-[11px] font-medium text-[#6b6f76]">
                {signal.matchedKeyword}
              </span>
            )}
          </p>
          <span className="shrink-0 text-[12px] text-[#8b8d94]">{timeAgo(data.postedAt)}</span>
        </div>
        {data.caption && (
          <p className="text-[13px] leading-relaxed text-[#6b6f76]">
            {truncate(data.caption, 280)}
          </p>
        )}
      </a>

      {/* Bottom: action bar */}
      <div className="flex items-center justify-between border-t border-[#ededf0] bg-[#f9f9fb] px-4 py-2.5">
        {/* Left: engagement */}
        <div className="flex items-center gap-2.5 text-[12px] text-[#8b8d94]">
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
              className="flex items-center rounded-md border border-[#e6e6e9] bg-white px-3 py-1.5 text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7]"
            >
              Restore
            </button>
          ) : (
            <>
              <button
                onClick={onDismiss}
                className="flex items-center rounded-md border border-[#e6e6e9] bg-white px-3 py-1.5 text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7]"
              >
                Dismiss
              </button>
              <button
                onClick={onEmail}
                className="flex items-center gap-1.5 rounded-md border border-[#e6e6e9] bg-white px-3 py-1.5 text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7]"
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
  const buyers = persons.filter((p) => p.companyDomain === domain && (p.workEmail || (p.availableEmails && p.availableEmails.length > 0)));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[20vh] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-lg bg-white shadow-xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#ededf0] px-4 py-3">
          <div>
            <p className="text-[13px] font-medium text-[#1b1b1f]">Email a buyer at {domain}</p>
            {jobs.length > 0 && (
              <p className="mt-0.5 text-[12px] text-[#8b8d94]">Re: {jobs[0].title}{jobs.length > 1 ? ` +${jobs.length - 1} more` : ""}</p>
            )}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-[#8b8d94] hover:bg-[#ededf0]">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {buyers.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px] text-[#8b8d94]">
            No contacts with emails found for {domain}.<br />Add people from this company first.
          </div>
        ) : (
          <div className="divide-y divide-[#ededf0]">
            {buyers.map((p) => {
              const email = p.workEmail || p.availableEmails?.[0]?.email || "";
              return (
                <button
                  key={p._id}
                  onClick={() => onSelect(p)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[#f5f5f7]"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f5f5f7] text-[13px] font-medium text-[#6b6f76]">
                    {(p.fullName ?? email ?? "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    {p.fullName && <p className="text-[13px] font-medium text-[#1b1b1f] truncate">{p.fullName}</p>}
                    <p className="text-[12px] text-[#8b8d94] truncate">{email}</p>
                  </div>
                </button>
              );
            })}
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
    <div className={`overflow-hidden rounded-lg border bg-white transition-all duration-200 ${onRestore ? "border-[#ededf0] opacity-60" : "border-[#e6e6e9]"}`}>
      {/* Clickable content area — links to first job's page */}
      <a
        href={item.jobs[0]?.jobUrl ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        className={`block px-4 pt-4 pb-5 ${item.jobs[0]?.jobUrl ? "cursor-pointer" : "cursor-default"}`}
        onClick={(e) => { if (!item.jobs[0]?.jobUrl) e.preventDefault(); }}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="flex flex-wrap items-center gap-1.5 text-[14px] leading-relaxed text-[#6b6f76]">
            <CompanyChip domain={domain} />
            <span>posted {item.jobs.length} new job{item.jobs.length !== 1 ? "s" : ""}</span>
          </p>
          <span className="shrink-0 text-[12px] text-[#8b8d94]">{timeAgo(item.signal.createdAt)}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {item.jobs.slice(0, 4).map((job, i) => (
            <div key={i} className="flex items-center gap-2 text-[13px]">
              <span className="font-medium text-[#6b6f76]">{job.title}</span>
              {job.location && <span className="text-[#8b8d94]">{job.location}</span>}
              {job.department && <span className="rounded-md bg-[#f5f5f7] px-1.5 py-0.5 text-[11px] text-[#6b6f76]">{job.department}</span>}
            </div>
          ))}
          {item.jobs.length > 4 && (
            <span className="text-[12px] text-[#8b8d94]">+{item.jobs.length - 4} more</span>
          )}
        </div>
      </a>

      {/* Bottom: action bar */}
      <div className="flex items-center justify-end gap-2 border-t border-[#ededf0] bg-[#f9f9fb] px-4 py-2.5">
        {onRestore ? (
          <button
            onClick={onRestore}
            className="flex items-center rounded-md border border-[#e6e6e9] bg-white px-3 py-1.5 text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7]"
          >
            Restore
          </button>
        ) : (
          <>
            <button
              onClick={onDismiss}
              className="flex items-center rounded-md border border-[#e6e6e9] bg-white px-3 py-1.5 text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7]"
            >
              Dismiss
            </button>
            <button
              onClick={onEmail}
              className="flex items-center gap-1.5 rounded-md border border-[#e6e6e9] bg-white px-3 py-1.5 text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7]"
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
/*  Funded Startup Card                                                 */
/* ------------------------------------------------------------------ */

function FundedStartupCard({
  item,
  onDismiss,
  onRestore,
}: {
  item: FundedStartupDisplayItem;
  onDismiss: () => void;
  onRestore?: () => void;
}) {
  const { startups } = item.signal.data;
  return (
    <div className={`overflow-hidden rounded-lg border bg-white transition-all duration-200 ${onRestore ? "border-[#ededf0] opacity-60" : "border-[#e6e6e9]"}`}>
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ecfdf5] text-[#059669]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
            </span>
            <span className="text-[13px] font-medium text-[#1b1b1f]">
              {startups.length} recently funded startup{startups.length !== 1 ? "s" : ""}
            </span>
          </div>
          <span className="shrink-0 text-[12px] text-[#8b8d94]">{timeAgo(item.signal.createdAt)}</span>
        </div>
        <div className="flex flex-col gap-2.5">
          {startups.map((startup, i) => (
            <div key={i} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${startup.websiteDomain}&sz=16`}
                    alt=""
                    width={14}
                    height={14}
                    className="shrink-0 rounded-sm"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <span className="text-[13px] font-medium text-[#1b1b1f] truncate">
                    {startup.citationUrl ? (
                      <a href={startup.citationUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {startup.companyName}
                      </a>
                    ) : startup.companyName}
                  </span>
                  <span className="shrink-0 rounded-full bg-[#ecfdf5] px-1.5 py-0.5 text-[10px] font-semibold text-[#059669]">
                    {startup.fundingAmount}
                  </span>
                </div>
                {startup.investors.length > 0 && (
                  <p className="mt-0.5 text-[11px] text-[#8b8d94] truncate">
                    {startup.investors.slice(0, 3).join(", ")}{startup.investors.length > 3 ? ` +${startup.investors.length - 3}` : ""}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-[#ededf0] bg-[#f9f9fb] px-4 py-2.5">
        {onRestore ? (
          <button onClick={onRestore} className="flex items-center rounded-md border border-[#e6e6e9] bg-white px-3 py-1.5 text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7]">Restore</button>
        ) : (
          <button onClick={onDismiss} className="flex items-center rounded-md border border-[#e6e6e9] bg-white px-3 py-1.5 text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7]">Dismiss</button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Find Times — shared types + helpers                                 */
/* ------------------------------------------------------------------ */

interface CalendarEventSlim {
  start: string;
  end: string;
  allDay: boolean;
}

interface AvailableSlot {
  start: string;
  end: string;
}

function toLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatSlotText(slot: AvailableSlot): string {
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  const dateStr = start.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const startTime = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const endTime = end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${dateStr} · ${startTime} – ${endTime}`;
}

/* ------------------------------------------------------------------ */
/*  Week calendar for Find Times                                        */
/* ------------------------------------------------------------------ */

function FindTimesWeekCalendar({
  selectedDates,
  onToggleDate,
  authToken,
  apiBaseUrl,
}: {
  selectedDates: string[];
  onToggleDate: (date: string) => void;
  authToken: string;
  apiBaseUrl: string;
}) {
  const [weekStart, setWeekStart] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const diff = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - diff);
    return d;
  });
  const [weekEvents, setWeekEvents] = useState<CalendarEventSlim[]>([]);
  const [weekLoading, setWeekLoading] = useState(false);
  const todayKey = toLocalDateKey(new Date());

  useEffect(() => {
    if (!authToken) return;
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59);
    void (async () => {
      setWeekLoading(true);
      try {
        const res = await apiFetch(
          `${apiBaseUrl}/calendar/events?timeMin=${encodeURIComponent(weekStart.toISOString())}&timeMax=${encodeURIComponent(end.toISOString())}`,
          { headers: { Authorization: `Bearer ${authToken}` } },
        );
        if (res.ok) {
          const data = (await res.json()) as { events: CalendarEventSlim[] };
          setWeekEvents(data.events ?? []);
        }
      } catch { /* ignore */ } finally {
        setWeekLoading(false);
      }
    })();
  }, [weekStart, authToken, apiBaseUrl]);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    }),
    [weekStart],
  );

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEventSlim[]>();
    for (const e of weekEvents) {
      if (e.allDay) continue;
      const key = toLocalDateKey(new Date(e.start));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }, [weekEvents]);

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    return d;
  }, [weekStart]);

  const weekLabel = useMemo(() => {
    if (weekStart.getMonth() === weekEnd.getMonth()) {
      return `${weekStart.toLocaleDateString("en-US", { month: "short" })} ${weekStart.getDate()} – ${weekEnd.getDate()}, ${weekStart.getFullYear()}`;
    }
    return `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }, [weekStart, weekEnd]);

  return (
    <div className="overflow-hidden rounded-lg border border-[#e3e8ee] bg-white">
      <div className="p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <button
            onClick={() => setWeekStart((p) => { const d = new Date(p); d.setDate(d.getDate() - 7); return d; })}
            className="rounded p-0.5 text-[#8b8d94] transition-colors hover:text-[#1b1b1f]"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-[10px] font-semibold text-[#1b1b1f]">{weekLabel}</span>
          <button
            onClick={() => setWeekStart((p) => { const d = new Date(p); d.setDate(d.getDate() + 7); return d; })}
            className="rounded p-0.5 text-[#8b8d94] transition-colors hover:text-[#1b1b1f]"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
        {weekLoading ? (
          <div className="flex justify-center py-4">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#e3e8ee] border-t-[#6b6f76]" />
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-0.5">
            {weekDays.map((day) => {
              const dateKey = toLocalDateKey(day);
              const isPast = dateKey < todayKey;
              const isSelected = selectedDates.includes(dateKey);
              const isToday = dateKey === todayKey;
              const dayEvts = (eventsByDay.get(dateKey) ?? []).sort(
                (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
              );
              const shown = dayEvts.slice(0, 3);
              const extra = dayEvts.length - 3;
              const dayAbbr = day.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2);
              return (
                <button
                  key={dateKey}
                  disabled={isPast}
                  onClick={() => onToggleDate(dateKey)}
                  className={[
                    "flex flex-col items-center gap-0.5 rounded-md px-0.5 py-1.5 transition-colors w-full",
                    isPast ? "cursor-not-allowed opacity-40" : "cursor-pointer",
                    isSelected ? "bg-[#1b1b1f]"
                      : isToday ? "bg-[#f0f0f5] hover:bg-[#e8e8ed]"
                      : !isPast ? "hover:bg-[#f5f5f7]" : "",
                  ].join(" ")}
                >
                  <span className={["text-[8px] font-medium leading-none", isSelected ? "text-white/70" : "text-[#8b8d94]"].join(" ")}>
                    {dayAbbr}
                  </span>
                  <span className={["text-[11px] font-bold leading-none mb-0.5", isSelected ? "text-white" : "text-[#1b1b1f]"].join(" ")}>
                    {day.getDate()}
                  </span>
                  {shown.map((e, i) => (
                    <div key={i} className={["w-full rounded px-0.5 py-px text-[7px] font-medium leading-tight text-center truncate", isSelected ? "bg-white/20 text-white" : "bg-[#e8e8ed] text-[#6b6f76]"].join(" ")}>
                      {new Date(e.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).replace(":00", "").toLowerCase()}
                    </div>
                  ))}
                  {extra > 0 && <span className={["text-[7px] leading-none", isSelected ? "text-white/50" : "text-[#8b8d94]"].join(" ")}>+{extra}</span>}
                  {dayEvts.length === 0 && !isPast && <span className={["text-[7px] leading-none", isSelected ? "text-white/60" : "text-green-600"].join(" ")}>free</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Find Times panel (inline in email modal)                            */
/* ------------------------------------------------------------------ */

function FindTimesPanel({
  authToken,
  apiBaseUrl,
  onInsert,
  onClose,
}: {
  authToken: string;
  apiBaseUrl: string;
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const [duration, setDuration] = useState(30);
  const [numSlots, setNumSlots] = useState(3);
  const [mode, setMode] = useState<"auto" | "specific">("auto");
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [results, setResults] = useState<AvailableSlot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<"config" | "results">("config");

  function toggleDate(dateKey: string) {
    setSelectedDates((prev) =>
      prev.includes(dateKey) ? prev.filter((d) => d !== dateKey) : [...prev, dateKey]
    );
  }

  async function handleFind() {
    setLoading(true);
    setResults(null);
    setStage("results");
    try {
      let datesToCheck: string[];
      if (mode === "specific" && selectedDates.length > 0) {
        datesToCheck = [...selectedDates].sort();
      } else {
        datesToCheck = [];
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        while (datesToCheck.length < 21) {
          const dow = d.getDay();
          if (dow !== 0 && dow !== 6) datesToCheck.push(toLocalDateKey(d));
          d.setDate(d.getDate() + 1);
        }
      }
      if (datesToCheck.length === 0) { setResults([]); return; }

      const timeMin = new Date(datesToCheck[0] + "T00:00:00").toISOString();
      const timeMax = new Date(datesToCheck[datesToCheck.length - 1] + "T23:59:59").toISOString();
      let busyEvents: CalendarEventSlim[] = [];
      try {
        const res = await apiFetch(
          `${apiBaseUrl}/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
        if (res.ok) {
          const data = (await res.json()) as { events: CalendarEventSlim[] };
          busyEvents = data.events ?? [];
        }
      } catch { /* use empty busy list */ }

      const busyByDay = new Map<string, { start: number; end: number }[]>();
      for (const e of busyEvents) {
        if (e.allDay) continue;
        const key = toLocalDateKey(new Date(e.start));
        if (!busyByDay.has(key)) busyByDay.set(key, []);
        busyByDay.get(key)!.push({ start: new Date(e.start).getTime(), end: new Date(e.end).getTime() });
      }

      const SLOT_MS = duration * 60 * 1000;
      const ROUND_MS = 15 * 60 * 1000;
      const todayKey = toLocalDateKey(new Date());
      const now = Date.now();
      const found: AvailableSlot[] = [];
      const isSingleDay = mode === "specific" && selectedDates.length === 1;

      if (isSingleDay) {
        const dateKey = datesToCheck[0];
        const [y, mo, d] = dateKey.split("-").map(Number);
        const dayStart = new Date(y, mo - 1, d, 9, 0, 0).getTime();
        const dayEnd = new Date(y, mo - 1, d, 18, 0, 0).getTime();
        let cursor = dateKey === todayKey ? Math.max(dayStart, Math.ceil(now / ROUND_MS) * ROUND_MS) : dayStart;
        const busy = (busyByDay.get(dateKey) ?? []).sort((a, b) => a.start - b.start);
        while (cursor + SLOT_MS <= dayEnd && found.length < numSlots) {
          const conflict = busy.find((b) => b.start < cursor + SLOT_MS && b.end > cursor);
          if (!conflict) { found.push({ start: new Date(cursor).toISOString(), end: new Date(cursor + SLOT_MS).toISOString() }); cursor += SLOT_MS; }
          else { cursor = Math.ceil(conflict.end / ROUND_MS) * ROUND_MS; }
        }
      } else {
        for (const dateKey of datesToCheck) {
          if (found.length >= numSlots) break;
          const [y, mo, d] = dateKey.split("-").map(Number);
          const dayStart = new Date(y, mo - 1, d, 9, 0, 0).getTime();
          const dayEnd = new Date(y, mo - 1, d, 18, 0, 0).getTime();
          let cursor = dateKey === todayKey ? Math.max(dayStart, Math.ceil(now / ROUND_MS) * ROUND_MS) : dayStart;
          const busy = (busyByDay.get(dateKey) ?? []).sort((a, b) => a.start - b.start);
          while (cursor + SLOT_MS <= dayEnd) {
            const conflict = busy.find((b) => b.start < cursor + SLOT_MS && b.end > cursor);
            if (!conflict) { found.push({ start: new Date(cursor).toISOString(), end: new Date(cursor + SLOT_MS).toISOString() }); break; }
            cursor = Math.ceil(conflict.end / ROUND_MS) * ROUND_MS;
          }
        }
      }
      setResults(found);
    } finally {
      setLoading(false);
    }
  }

  function handleInsert() {
    if (!results || results.length === 0) return;
    const lines = results.map((s, i) => `Option ${i + 1}: ${formatSlotText(s)}`).join("\n");
    onInsert(`Here are some times that work for me:\n\n${lines}`);
  }

  const selectCls = "w-full rounded-md border border-[#e3e8ee] bg-white px-2.5 py-1.5 text-[12px] font-medium text-[#1a1f36] focus:outline-none focus:ring-1 focus:ring-[#1b1b1f] appearance-none cursor-pointer";

  return (
    <div className="border-t border-[#e3e8ee] bg-[#f7fafc]">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#e3e8ee]">
        <div className="flex items-center gap-1.5">
          {stage === "results" && (
            <button onClick={() => setStage("config")} className="rounded p-0.5 text-[#8b8d94] hover:text-[#1b1b1f] transition-colors">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <span className="text-[12px] font-semibold text-[#1a1f36]">
            {stage === "config" ? "Find Available Times" : "Available Times"}
          </span>
        </div>
        <button onClick={onClose} className="rounded p-0.5 text-[#a3acb9] hover:text-[#4f566b] transition-colors">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="px-4 py-3 space-y-3">
        {stage === "config" ? (
          <>
            <div className="flex gap-2.5">
              <div className="flex-1">
                <p className="mb-1 text-[11px] font-medium text-[#6b6f76]">Duration</p>
                <div className="relative">
                  <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={selectCls}>
                    {[{ label: "15 min", value: 15 }, { label: "30 min", value: 30 }, { label: "1 hour", value: 60 }, { label: "90 min", value: 90 }, { label: "2 hours", value: 120 }].map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <svg className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#8b8d94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                </div>
              </div>
              <div className="flex-1">
                <p className="mb-1 text-[11px] font-medium text-[#6b6f76]">Slots</p>
                <div className="relative">
                  <select value={numSlots} onChange={(e) => setNumSlots(Number(e.target.value))} className={selectCls}>
                    {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} slot{n !== 1 ? "s" : ""}</option>)}
                  </select>
                  <svg className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#8b8d94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                </div>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-medium text-[#6b6f76]">Time range</p>
              <div className="flex gap-1.5">
                <button onClick={() => { setMode("auto"); setSelectedDates([]); }} className={["flex-1 rounded-md border py-1.5 text-[11px] font-medium transition-colors", mode === "auto" ? "border-[#1b1b1f] bg-[#1b1b1f] text-white" : "border-[#e3e8ee] bg-white text-[#6b6f76] hover:bg-[#f5f5f7]"].join(" ")}>
                  Next available
                </button>
                <button onClick={() => setMode("specific")} className={["flex-1 rounded-md border py-1.5 text-[11px] font-medium transition-colors", mode === "specific" ? "border-[#1b1b1f] bg-[#1b1b1f] text-white" : "border-[#e3e8ee] bg-white text-[#6b6f76] hover:bg-[#f5f5f7]"].join(" ")}>
                  Pick dates
                </button>
              </div>
              {mode === "specific" && (
                <div className="mt-2">
                  <FindTimesWeekCalendar selectedDates={selectedDates} onToggleDate={toggleDate} authToken={authToken} apiBaseUrl={apiBaseUrl} />
                  {selectedDates.length > 0 && (
                    <p className="mt-1.5 text-[10px] text-[#8b8d94]">{selectedDates.length} date{selectedDates.length !== 1 ? "s" : ""} selected</p>
                  )}
                </div>
              )}
            </div>

            <button onClick={() => void handleFind()} disabled={mode === "specific" && selectedDates.length === 0} className="w-full rounded-lg bg-[#1b1b1f] py-2 text-[12px] font-semibold text-white transition-colors hover:bg-[#2d2d33] disabled:cursor-not-allowed disabled:opacity-40">
              Next
            </button>
          </>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#e3e8ee] border-t-[#1b1b1f]" />
            <p className="text-[11px] text-[#a3acb9]">Finding slots…</p>
          </div>
        ) : results !== null && results.length === 0 ? (
          <p className="py-4 text-center text-[12px] text-[#a3acb9]">No open slots found.</p>
        ) : results !== null ? (
          <>
            <div className="space-y-1.5">
              {results.map((slot, i) => (
                <div key={i} className="rounded-lg border border-[#e3e8ee] bg-white px-3 py-2">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-[#a3acb9]">Option {i + 1}</p>
                  <p className="mt-0.5 text-[12px] font-medium text-[#1a1f36]">{formatSlotText(slot)}</p>
                </div>
              ))}
            </div>
            <button onClick={handleInsert} className="w-full rounded-lg bg-[#1b1b1f] py-2 text-[12px] font-semibold text-white transition-colors hover:bg-[#2d2d33]">
              Insert into email
            </button>
          </>
        ) : null}
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
  signature,
}: {
  modal: EmailModal;
  onChange: (m: EmailModal) => void;
  onSend: () => void;
  onClose: () => void;
  sending: boolean;
  error: string;
  apiBaseUrl: string;
  authToken: string;
  signature: string;
}) {
  const [findingEmail, setFindingEmail] = useState(false);
  const [findError, setFindError] = useState("");
  const [templates, setTemplates] = useState<{ _id: string; title: string; body: string }[]>([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showFindTimes, setShowFindTimes] = useState(false);
  const dataFetched = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const quillRef = useRef<any>(null);
  const quillContainerRef = useRef<HTMLDivElement>(null);
  const skipSyncRef = useRef(false);
  // Always-current refs so Quill callbacks never close over stale state
  const modalRef = useRef(modal);
  modalRef.current = modal;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!authToken || dataFetched.current) return;
    dataFetched.current = true;
    void apiFetch(`${apiBaseUrl}/email-templates`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async (res) => {
        const data = (await res.json()) as { templates: { _id: string; title: string; body: string }[] };
        setTemplates(data.templates ?? []);
      })
      .catch(() => {});
  }, [authToken, apiBaseUrl]);

  // Initialise Quill once the container is in the DOM
  useEffect(() => {
    if (!quillContainerRef.current || quillRef.current) return;
    void (async () => {
      const { default: Quill } = await import("quill");
      if (!quillContainerRef.current || quillRef.current) return;
      const quill = new Quill(quillContainerRef.current, {
        theme: "snow",
        placeholder: "Write your message…",
        modules: {
          toolbar: [
            ["bold", "italic", "underline", "strike"],
            [{ list: "bullet" }, { list: "ordered" }],
            ["link", "clean"],
          ],
        },
      });
      quillRef.current = quill;
      // Seed with any initial body content
      if (modal.body) {
        quill.clipboard.dangerouslyPasteHTML(modal.body);
        quill.setSelection(quill.getLength(), 0);
      }
      if (modal.to) quill.focus();
      quill.on("text-change", () => {
        skipSyncRef.current = true;
        const html = quill.root.innerHTML;
        onChangeRef.current({ ...modalRef.current, body: html === "<p><br></p>" ? "" : html });
      });
    })();
    return () => { quillRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external body changes (template apply, find-times insert) into Quill
  useEffect(() => {
    if (!quillRef.current) return;
    if (skipSyncRef.current) { skipSyncRef.current = false; return; }
    const current = quillRef.current.root.innerHTML;
    const normalised = current === "<p><br></p>" ? "" : current;
    if (modal.body !== normalised) {
      quillRef.current.clipboard.dangerouslyPasteHTML(modal.body || "");
    }
  }, [modal.body]);

  const pendingResolveRef = useRef<{ subject: string; body: string } | null>(null);

  function applyTemplate(tmpl: { title: string; body: string }) {
    const resolved = tmpl.body
      .replace(/\{\{email\}\}/g, modal.to || "");
    onChange({ ...modal, subject: tmpl.title, body: resolved });
    pendingResolveRef.current = { subject: tmpl.title, body: resolved };
    setShowTemplatePicker(false);
    if (modal.personId) {
      void apiFetch(`${apiBaseUrl}/persons/${modal.personId}`, { headers: { Authorization: `Bearer ${authToken}` } })
        .then(async (res) => {
          const data = (await res.json()) as { person?: { enrichmentData?: Record<string, unknown>; companyDomain?: string } };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const raw = data.person?.enrichmentData as any;
          const fiber = raw?.output?.data?.[0] as Record<string, unknown> | undefined;
          const pending = pendingResolveRef.current;
          if (!fiber || !pending) return;
          const firstName = (fiber.first_name as string) ?? "";
          const fullName = [fiber.first_name, fiber.last_name].filter(Boolean).join(" ") || (fiber.name as string) || "";
          const website = data.person?.companyDomain ?? "";
          onChange({
            ...modal,
            subject: pending.subject,
            body: pending.body
              .replace(/\{\{first_name\}\}/g, firstName)
              .replace(/\{\{full_name\}\}/g, fullName)
              .replace(/\{\{website\}\}/g, website)
              .replace(/\{\{ats_name\}\}/g, ""),
          });
          pendingResolveRef.current = null;
        })
        .catch(() => {});
    }
  }

  async function handleFindEmail() {
    if (!modal.personId || !authToken) return;
    setFindingEmail(true);
    setFindError("");
    try {
      const res = await apiFetch(`${apiBaseUrl}/persons/${modal.personId}/find-email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = (await res.json()) as { email?: string | null; emails?: { email: string; type: string }[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      const allEmails = data.emails ?? (data.email ? [{ email: data.email, type: "work" }] : []);
      if (data.email) {
        onChange({ ...modal, to: data.email, availableEmails: allEmails });
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[8vh]"
      onClick={() => !sending && onClose()}
    >
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        style={{ maxHeight: "calc(100vh - 16vh)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#e3e8ee] px-5 py-3.5">
          <h2 className="text-[14px] font-semibold text-[#1a1f36]">New Message</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowFindTimes((p) => !p)}
              className={["flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors", showFindTimes ? "bg-[#1b1b1f] text-white" : "text-[#6b6f76] hover:bg-[#f5f5f7]"].join(" ")}
              title="Find available times"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Find Times
            </button>
            <div className="relative">
              <button
                onClick={() => setShowTemplatePicker((p) => !p)}
                className="rounded-md px-2.5 py-1.5 text-[12px] font-medium text-[#6b6f76] hover:bg-[#f5f5f7] transition-colors"
              >
                Use template
              </button>
              {showTemplatePicker && (
                <div className="absolute right-0 top-full mt-1 w-64 rounded-lg border border-[#e3e8ee] bg-white shadow-lg z-20 overflow-hidden max-h-64 overflow-y-auto">
                  {templates.length === 0 ? (
                    <p className="px-3 py-3 text-[12px] text-[#a3acb9]">No templates yet</p>
                  ) : (
                    templates.map((t) => (
                      <button
                        key={t._id}
                        onClick={() => applyTemplate(t)}
                        className="flex w-full flex-col px-3 py-2 text-left hover:bg-[#f7fafc] transition-colors"
                      >
                        <span className="text-[12px] font-medium text-[#1a1f36]">{t.title}</span>
                        <span className="text-[11px] text-[#a3acb9] line-clamp-1 font-mono">{t.body}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-[#a3acb9] transition-colors hover:bg-[#f5f5f7] hover:text-[#4f566b]"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Fields */}
        <div className="flex flex-col divide-y divide-[#f0f3f8]">
          {/* To */}
          <div className="flex items-center gap-3 px-5 py-2.5">
            <span className="w-12 shrink-0 text-[13px] text-[#a3acb9]">To</span>
            {(modal.availableEmails?.length ?? 0) > 1 ? (
              /* Multiple emails — show dropdown, work email selected by default */
              <div className="relative flex-1">
                <select
                  value={modal.to}
                  onChange={(e) => onChange({ ...modal, to: e.target.value })}
                  className="w-full appearance-none bg-transparent text-[13px] text-[#1a1f36] focus:outline-none pr-5 cursor-pointer"
                >
                  {modal.availableEmails!
                    .sort((a, b) => (a.type === "work" ? -1 : 1) - (b.type === "work" ? -1 : 1))
                    .map((e) => (
                      <option key={e.email} value={e.email}>
                        {e.email}{e.type === "work" ? " (work)" : " (personal)"}
                      </option>
                    ))}
                </select>
                <svg className="pointer-events-none absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#a3acb9]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            ) : (
              <input
                className="flex-1 text-[13px] text-[#1a1f36] placeholder:text-[#c2c7cf] focus:outline-none"
                value={modal.to}
                onChange={(e) => onChange({ ...modal, to: e.target.value, personId: null })}
                placeholder="recipient@company.com"
                autoFocus={!modal.to}
              />
            )}
            {!modal.to && modal.personId && (
              <button
                onClick={handleFindEmail}
                disabled={findingEmail}
                className="shrink-0 flex items-center gap-1.5 rounded-md bg-[#1b1b1f] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#2c2c33] disabled:opacity-50"
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
          <div className="flex items-center gap-3 px-5 py-2.5">
            <span className="w-12 shrink-0 text-[13px] text-[#a3acb9]">Subject</span>
            <input
              className="flex-1 text-[13px] text-[#1a1f36] placeholder:text-[#c2c7cf] focus:outline-none"
              value={modal.subject}
              onChange={(e) => onChange({ ...modal, subject: e.target.value })}
              placeholder="Subject"
            />
          </div>
        </div>

        {/* Quill rich-text body */}
        <div className="email-quill-editor border-b border-[#f0f3f8]">
          <div ref={quillContainerRef} />
          {signature && (
            <div className="border-t border-[#f0f3f8] px-5 py-2">
              <div className="text-[13px] text-[#8b8d94] leading-relaxed [&_p]:m-0 [&_a]:text-[#5e6ad2] [&_a]:underline" dangerouslySetInnerHTML={{ __html: signature }} />
            </div>
          )}
        </div>

        {/* Find Times panel */}
        {showFindTimes && (
          <FindTimesPanel
            authToken={authToken}
            apiBaseUrl={apiBaseUrl}
            onClose={() => setShowFindTimes(false)}
            onInsert={(text) => {
              if (quillRef.current) {
                const len = quillRef.current.getLength();
                quillRef.current.insertText(len - 1, "\n\n" + text, "user");
                quillRef.current.setSelection(quillRef.current.getLength(), 0);
              }
              setShowFindTimes(false);
            }}
          />
        )}

        {/* Footer */}
        <div className="border-t border-[#e3e8ee]">
          {/* Send row */}
          <div className="flex items-center justify-between px-5 py-3">
            {error ? (
              <p className="text-[12px] text-red-600">{error}</p>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                disabled={sending}
                className="rounded-md px-3.5 py-1.5 text-[13px] font-medium text-[#6b6f76] hover:bg-[#f5f5f7] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={onSend}
                disabled={sending || !modal.to.trim()}
                className="flex items-center gap-1.5 rounded-md bg-[#1b1b1f] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#2c2c33] disabled:opacity-50 transition-colors"
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
  const [emailSignature, setEmailSignature] = useState("");
  const sigFetched = useRef(false);
  useEffect(() => {
    if (!token || sigFetched.current) return;
    sigFetched.current = true;
    void apiFetch(`${apiBaseUrl}/email-signature`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => { const d = (await res.json()) as { signature: string }; setEmailSignature(d.signature ?? ""); })
      .catch(() => {});
  }, [token, apiBaseUrl]);

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
      } else if (s.signalType === "recently_funded") {
        const key = toDateKey(s.createdAt);
        map.set(key, (map.get(key) ?? 0) + (s.data.startups?.length ?? 1));
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
    const emails = person?.availableEmails ?? (person?.workEmail ? [{ email: person.workEmail, type: "work" }] : []);
    setEmailError("");
    setEmailModal({
      to: person?.workEmail ?? "",
      subject: `Following up re: your recent post`,
      body: "",
      personId: person?._id ?? null,
      availableEmails: emails,
    });
  }

  function openEmailForATS(signal: ATSJobSignal) {
    setBuyerPickerSignal(signal);
  }

  function openEmailForBuyer(person: PersonInfo, signal: ATSJobSignal) {
    const domain = signal.data.companyDomain ?? signal.companyDomain;
    const firstJob = signal.data.jobs[0];
    const emails = person.availableEmails ?? (person.workEmail ? [{ email: person.workEmail, type: "work" }] : []);
    const bestEmail = person.workEmail || person.availableEmails?.[0]?.email || "";
    setBuyerPickerSignal(null);
    setEmailError("");
    setEmailModal({
      to: bestEmail,
      subject: firstJob
        ? `Re: ${firstJob.title} at ${domain ?? ""}`
        : `Following up on ${domain ?? ""}`,
      body: "",
      personId: person._id,
      availableEmails: emails,
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
      } else if (s.signalType === "recently_funded") {
        map.get(key)!.push({ kind: "funded_startup", signal: s });
      } else {
        map.get(key)!.push({ kind: "linkedin", signal: s });
      }
    }
    return map;
  }, [dismissedSignals]);

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Greeting header */}
        <div className="flex flex-col items-center pt-10 pb-4 text-center">
          <h1 className="text-[30px] font-medium tracking-tight text-[#1b1b1f]">
            {getGreeting()}{userName ? `, ${userName}` : ""} 👋
          </h1>
        </div>

        {/* Week date strip */}
        <div className="pb-6">
          <WeekStrip
            selectedDateKey={selectedDateKey}
            onSelect={setSelectedDateKey}
            signalCountByDate={signalCountByDate}
          />
        </div>

        {/* Feed */}
        <div className="mx-auto w-full max-w-xl px-4 pb-16">
          {loading ? (
            <div className="flex flex-col gap-3 py-4 animate-pulse">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-xl border border-[#e6e6e9] bg-white p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-9 w-9 rounded-full bg-[#f0f0f2]" />
                    <div className="flex-1">
                      <div className="h-3 w-28 rounded bg-[#f0f0f2] mb-1.5" />
                      <div className="h-2.5 w-20 rounded bg-[#f5f5f7]" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="h-2.5 w-full rounded bg-[#f5f5f7]" />
                    <div className="h-2.5 w-4/5 rounded bg-[#f5f5f7]" />
                    <div className="h-2.5 w-3/5 rounded bg-[#f5f5f7]" />
                  </div>
                </div>
              ))}
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
                      <div className="flex flex-col gap-2">
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

                          if (item.kind === "funded_startup") {
                            return (
                              <FundedStartupCard
                                key={key}
                                item={item}
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
                      <div className="h-px flex-1 bg-[#e6e6e9]" />
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-medium text-[#8b8d94] group-hover:text-[#6b6f76] transition-colors">Dismissed</span>
                        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#e6e6e9] px-1 text-[10px] font-medium text-[#6b6f76] group-hover:bg-[#d4d4d8] transition-colors">
                          {dismissedItems.length}
                        </span>
                        <svg
                          className={`h-3 w-3 text-[#8b8d94] transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      </div>
                      <div className="h-px flex-1 bg-[#e6e6e9]" />
                    </button>

                    {isExpanded && (
                      <div className="mt-3 flex flex-col gap-2">
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

                          if (item.kind === "funded_startup") {
                            return (
                              <FundedStartupCard
                                key={key}
                                item={item}
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
          signature={emailSignature}
        />
      )}
    </div>
  );
}
