"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LetterAvatar, safeJson, apiFetch } from "../components";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

interface MatchedPerson {
  personId: string;
  name: string;
  email: string;
  title?: string;
  companyName?: string;
  companyDomain?: string;
  profilePic?: string;
}

interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  allDay: boolean;
  attendees: { email: string; name?: string; self?: boolean; responseStatus?: string }[];
  meetLink?: string;
  htmlLink?: string;
  organizer?: { email: string; name?: string; self?: boolean };
  sourceUserEmail?: string;
  sourceUserName?: string;
  matchedPersons?: MatchedPerson[];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatDateHeading(dateKey: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (dateKey === today) return "Today";
  if (dateKey === tomorrow) return "Tomorrow";
  const d = new Date(dateKey + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function eventDateKey(event: CalendarEvent): string {
  return event.allDay ? event.start.slice(0, 10) : new Date(event.start).toISOString().slice(0, 10);
}

function isSameDay(dateKey: string): boolean {
  return dateKey === new Date().toISOString().slice(0, 10);
}

function eventDuration(event: CalendarEvent): string {
  if (event.allDay) return "All day";
  const mins = Math.round((new Date(event.end).getTime() - new Date(event.start).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/* ------------------------------------------------------------------ */
/*  Meeting Card                                                        */
/* ------------------------------------------------------------------ */

function MeetingCard({ event, multiUser, connectedUsers }: { event: CalendarEvent; multiUser: boolean; connectedUsers: { email: string; name: string; profilePhotoUrl?: string | null }[] }) {
  const matched = event.matchedPersons ?? [];
  const sourceUser = multiUser && event.sourceUserEmail
    ? connectedUsers.find((u) => u.email === event.sourceUserEmail)
    : undefined;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm transition-all hover:shadow-md hover:border-zinc-300">
      {/* Top row: title + actions */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[14px] font-semibold text-zinc-900 truncate">{event.summary}</p>
          </div>
          <div className="mt-0.5 flex items-center gap-2 flex-wrap text-[12px] text-zinc-400">
            <span>
              {event.allDay
                ? "All day"
                : `${formatTime(event.start)} – ${formatTime(event.end)}`}
            </span>
            {!event.allDay && <span>· {eventDuration(event)}</span>}
            {event.location && (
              <span className="truncate max-w-[200px]">· {event.location}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {event.meetLink && (
            <a
              href={event.meetLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-100 transition-colors"
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z" />
              </svg>
              Join
            </a>
          )}
          {event.htmlLink && (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              Open
            </a>
          )}
        </div>
      </div>

      {/* Matched persons with company info */}
      {matched.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {matched.map((person) => (
            <div key={person.personId} className="flex items-center gap-3">
              <LetterAvatar name={person.name} size="sm" src={person.profilePic} />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-zinc-800 truncate">{person.name}</p>
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  {person.title && <span className="truncate">{person.title}</span>}
                  {person.title && person.companyName && <span>·</span>}
                  {person.companyName && <span className="truncate">{person.companyName}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Other attendees count */}
      {event.attendees.length > matched.length && (
        <p className="mt-2 text-[11px] text-zinc-400">
          +{event.attendees.length - matched.length} other attendee{event.attendees.length - matched.length !== 1 ? "s" : ""}
        </p>
      )}

      {/* Synced from indicator */}
      {sourceUser && (
        <div className="mt-2 flex items-center gap-1 group/source">
          <span className="text-[10px] text-zinc-400">Synced from</span>
          <div className="relative">
            {sourceUser.profilePhotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={sourceUser.profilePhotoUrl} alt="" className="h-3.5 w-3.5 rounded-full object-cover" />
            ) : (
              <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-zinc-200 text-[7px] font-bold text-zinc-500">
                {sourceUser.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/source:block">
              <div className="whitespace-nowrap rounded bg-zinc-800 px-2 py-1 text-[10px] text-white shadow-lg">
                {sourceUser.name.split(" ")[0]}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function CalendarPage() {
  return (
    <Suspense>
      <CalendarInner />
    </Suspense>
  );
}

function CalendarInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const [authToken, setAuthToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [connectedUsers, setConnectedUsers] = useState<{ email: string; name: string; profilePhotoUrl?: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const checkedRef = useRef(false);

  // Month navigation
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth());

  const monthLabel = useMemo(
    () => new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    [year, month],
  );

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  }

  const fetchEvents = useCallback(async (token: string, y: number, m: number, isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const timeMin = new Date(y, m, 1).toISOString();
      const timeMax = new Date(y, m + 1, 0, 23, 59, 59).toISOString();
      const res = await apiFetch(
        `${apiBaseUrl}/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        const data = (await safeJson(res)) as { error?: string };
        if (data.error === "needs_calendar_permission") {
          const urlRes = await apiFetch(
            `${apiBaseUrl}/auth/google/url?returnPath=/dashboard/calendar`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          const urlData = (await safeJson(urlRes)) as { url: string };
          if (urlData.url) { window.location.href = urlData.url; return; }
        }
        throw new Error(data.error ?? "Failed to fetch events");
      }
      const data = (await safeJson(res)) as { events: CalendarEvent[]; connectedUsers?: { email: string; name: string }[] };
      setEvents(data.events ?? []);
      setConnectedUsers(data.connectedUsers ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load meetings");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiBaseUrl]);

  // Init
  useEffect(() => {
    const token = window.localStorage.getItem(localStorageTokenKey);
    if (!token) { router.replace("/"); return; }
    setAuthToken(token);
    if (checkedRef.current) return;
    checkedRef.current = true;

    void apiFetch(`${apiBaseUrl}/gmail/status`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = (await safeJson(res)) as { connected: boolean };
        setConnected(data.connected);
        if (data.connected) void fetchEvents(token, year, month);
        else setLoading(false);
      })
      .catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle redirect back from Google OAuth
  useEffect(() => {
    if (searchParams.get("gmail") === "connected") {
      setConnected(true);
      if (authToken) void fetchEvents(authToken, year, month);
    }
  }, [searchParams, authToken, fetchEvents, year, month]);

  // Refetch when month changes
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    if (connected && authToken) void fetchEvents(authToken, year, month);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  async function connectGoogle() {
    const res = await apiFetch(
      `${apiBaseUrl}/auth/google/url?returnPath=/dashboard/calendar`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );
    const data = (await safeJson(res)) as { url: string };
    if (data.url) window.location.href = data.url;
  }

  // Only show meetings with at least one tracked person
  const meetings = useMemo(() => {
    // Deduplicate by event id
    const seen = new Set<string>();
    return events.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return (e.matchedPersons?.length ?? 0) > 0;
    });
  }, [events]);

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of meetings) {
      const key = eventDateKey(e);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [meetings]);

  const multiUser = connectedUsers.length >= 1;

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {/* Header */}
          <p className="text-[15px] text-zinc-500 leading-relaxed">
            Meetings with your tracked people and companies. Only calendar events with at least one tracked person are shown.
          </p>

          {/* Controls: month nav + refresh */}
          {connected && (
            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={prevMonth}
                  className="rounded-lg border border-zinc-200 bg-white p-1.5 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-700 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <span className="min-w-[160px] text-center text-[13px] font-semibold text-zinc-800">{monthLabel}</span>
                <button
                  onClick={nextMonth}
                  className="rounded-lg border border-zinc-200 bg-white p-1.5 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-700 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <span className="ml-2 text-[12px] text-zinc-400">
                  {meetings.length} meeting{meetings.length !== 1 ? "s" : ""}
                </span>
              </div>

              <button
                onClick={() => { if (authToken) void fetchEvents(authToken, year, month, true); }}
                disabled={refreshing}
                className="flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-[13px] font-medium text-zinc-700 transition-all hover:bg-zinc-50 disabled:opacity-50"
              >
                {refreshing ? (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
                ) : (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                  </svg>
                )}
                Refresh
              </button>
            </div>
          )}

          {/* Content */}
          <div className="mt-5">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
              </div>
            ) : !connected ? (
              <div className="flex items-center justify-center py-16">
                <div className="flex flex-col items-center gap-3">
                  <p className="text-[14px] text-zinc-400">Google Calendar not connected</p>
                  <button
                    onClick={connectGoogle}
                    className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-[13px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
                  >
                    Connect Google Calendar
                  </button>
                </div>
              </div>
            ) : error ? (
              <div className="flex items-center justify-center py-16">
                <p className="text-[13px] text-red-400">{error}</p>
              </div>
            ) : grouped.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <p className="text-[14px] text-zinc-400">No meetings with tracked people in {monthLabel}</p>
              </div>
            ) : (
              <div className="space-y-6">
                {grouped.map(([dateKey, dayEvents]) => (
                  <div key={dateKey}>
                    {/* Date heading */}
                    <div className="mb-3 flex items-center gap-3">
                      <div className={`flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg text-center ${isSameDay(dateKey) ? "bg-zinc-900 text-white" : "bg-white border border-zinc-200 text-zinc-700"}`}>
                        <span className="text-[10px] font-semibold uppercase leading-none tracking-wide">
                          {new Date(dateKey + "T12:00:00Z").toLocaleDateString("en-US", { month: "short" })}
                        </span>
                        <span className="text-[15px] font-bold leading-tight">
                          {new Date(dateKey + "T12:00:00Z").getDate()}
                        </span>
                      </div>
                      <div>
                        <p className={`text-[13px] font-semibold ${isSameDay(dateKey) ? "text-zinc-900" : "text-zinc-700"}`}>
                          {formatDateHeading(dateKey)}
                        </p>
                        <p className="text-[11px] text-zinc-400">
                          {dayEvents.length} meeting{dayEvents.length !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>

                    {/* Events */}
                    <div className="ml-12 space-y-3">
                      {dayEvents.map((event) => (
                        <MeetingCard key={event.id} event={event} multiUser={multiUser} connectedUsers={connectedUsers} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
