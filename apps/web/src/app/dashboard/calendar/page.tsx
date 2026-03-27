"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { safeJson } from "../components";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
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
}

function formatTime(iso: string, allDay: boolean): string {
  if (allDay) return "All day";
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
  const startMs = new Date(event.start).getTime();
  const endMs = new Date(event.end).getTime();
  const mins = Math.round((endMs - startMs) / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function responseColor(status?: string): string {
  if (status === "accepted") return "text-emerald-600";
  if (status === "declined") return "text-red-500";
  if (status === "tentative") return "text-amber-500";
  return "text-zinc-400";
}

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
  const [connectedUsers, setConnectedUsers] = useState<{ email: string; name: string }[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const checkedRef = useRef(false);

  // Month navigation — default to current month
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth()); // 0-indexed

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
      const res = await fetch(
        `${apiBaseUrl}/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        const data = (await safeJson(res)) as { error?: string };
        if (data.error === "needs_calendar_permission") {
          // Silently re-trigger Google OAuth to get calendar scope
          const urlRes = await fetch(
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
      setError(err instanceof Error ? err.message : "Failed to load calendar");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiBaseUrl]);

  // Init: get token + check connection
  useEffect(() => {
    const token = window.localStorage.getItem(localStorageTokenKey);
    if (!token) { router.replace("/"); return; }
    setAuthToken(token);

    if (checkedRef.current) return;
    checkedRef.current = true;

    void fetch(`${apiBaseUrl}/gmail/status`, { headers: { Authorization: `Bearer ${token}` } })
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

  // Refetch when month changes (only if already connected)
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    if (connected && authToken) void fetchEvents(authToken, year, month);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  async function connectGoogle() {
    const res = await fetch(
      `${apiBaseUrl}/auth/google/url?returnPath=/dashboard/calendar`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );
    const data = (await safeJson(res)) as { url: string };
    if (data.url) window.location.href = data.url;
  }

  const filteredEvents = useMemo(() => {
    if (selectedUser) return events.filter((e) => e.sourceUserEmail === selectedUser);
    // Deduplicate by event id when showing all accounts
    const seen = new Set<string>();
    return events.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }, [events, selectedUser]);

  // Group events by date
  const grouped = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of filteredEvents) {
      const key = eventDateKey(e);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredEvents]);

  return (
    <div className="flex h-full flex-col bg-white">

      {/* View as filter pills */}
      {connected && connectedUsers.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto border-b border-zinc-100 px-6 py-2 scrollbar-none">
          <span className="shrink-0 text-[11px] font-medium text-zinc-400">View as</span>
          <button
            onClick={() => setSelectedUser(null)}
            className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
              !selectedUser
                ? "bg-zinc-900 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            All
          </button>
          {connectedUsers.map((u) => (
            <button
              key={u.email}
              onClick={() => setSelectedUser(selectedUser === u.email ? null : u.email)}
              className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                selectedUser === u.email
                  ? "bg-zinc-900 text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
            >
              {u.name}
            </button>
          ))}
        </div>
      )}

      {/* Month navigation */}
      {connected && (
        <div className="flex items-center gap-3 border-b border-zinc-100 px-6 py-3">
          <button
            onClick={prevMonth}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="min-w-[160px] text-center text-[13px] font-semibold text-zinc-800">{monthLabel}</span>
          <button
            onClick={nextMonth}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <span className="ml-auto text-[12px] text-zinc-400">{filteredEvents.length} event{filteredEvents.length !== 1 ? "s" : ""}</span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
          </div>
        ) : !connected ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <p className="text-[14px] text-black/40">Calendar not connected</p>
              <button onClick={connectGoogle} className="rounded-lg border border-black/[0.08] px-4 py-2 text-[13px] font-medium text-black/70 hover:bg-black/[0.03]">
                Connect Google Calendar
              </button>
            </div>
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-[13px] text-red-400">{error}</p>
          </div>
        ) : grouped.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-[14px] text-black/40">No events in {monthLabel}</p>
          </div>
        ) : (
          <div className="mx-auto max-w-xl px-4 py-6 space-y-6">
            {grouped.map(([dateKey, dayEvents]) => (
              <div key={dateKey}>
                {/* Date heading */}
                <div className={`mb-3 flex items-center gap-3`}>
                  <div className={`flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-xl text-center ${isSameDay(dateKey) ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700"}`}>
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
                    <p className="text-[11px] text-zinc-400">{dayEvents.length} event{dayEvents.length !== 1 ? "s" : ""}</p>
                  </div>
                </div>

                {/* Events for this day */}
                <div className="ml-12 space-y-2">
                  {dayEvents.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-xl border border-zinc-100 bg-white px-4 py-3 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-[13px] font-semibold text-zinc-900 truncate">{event.summary}</p>
                            {event.sourceUserName && connectedUsers.length > 1 && (
                              <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">
                                {event.sourceUserName}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                            <span className="text-[12px] text-zinc-500">
                              {event.allDay
                                ? "All day"
                                : `${formatTime(event.start, false)} – ${formatTime(event.end, false)}`}
                            </span>
                            {!event.allDay && (
                              <span className="text-[11px] text-zinc-400">· {eventDuration(event)}</span>
                            )}
                            {event.location && (
                              <span className="flex items-center gap-1 text-[11px] text-zinc-400">
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                                </svg>
                                {event.location}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {event.meetLink && (
                            <a
                              href={event.meetLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-100"
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
                              className="text-[11px] text-zinc-400 hover:text-zinc-600"
                            >
                              Open
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Attendees */}
                      {event.attendees.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {event.attendees.slice(0, 6).map((a) => (
                            <span
                              key={a.email}
                              className={`inline-flex items-center rounded-full bg-zinc-50 border border-zinc-200 px-2 py-0.5 text-[11px] ${a.self ? "font-semibold text-zinc-700" : "text-zinc-500"}`}
                              title={`${a.name ?? a.email} — ${a.responseStatus ?? "unknown"}`}
                            >
                              <span className={`mr-1 h-1.5 w-1.5 rounded-full ${responseColor(a.responseStatus)} bg-current`} />
                              {a.name ?? a.email.split("@")[0]}
                            </span>
                          ))}
                          {event.attendees.length > 6 && (
                            <span className="text-[11px] text-zinc-400">+{event.attendees.length - 6} more</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
