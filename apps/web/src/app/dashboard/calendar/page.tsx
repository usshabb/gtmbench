"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LetterAvatar, safeJson, apiFetch, FallbackImg } from "../components";

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

interface AvailableSlot {
  start: string;
  end: string;
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

function toLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/*  Calendar Picker — Week view                                         */
/* ------------------------------------------------------------------ */

function AvailabilityCalendar({
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
    const diff = (d.getDay() + 6) % 7; // Mon = 0
    d.setDate(d.getDate() - diff);
    return d;
  });
  const [weekEvents, setWeekEvents] = useState<CalendarEvent[]>([]);
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
          const data = (await safeJson(res)) as { events: CalendarEvent[] };
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
    const map = new Map<string, CalendarEvent[]>();
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

  function prevWeek() {
    setWeekStart((prev) => { const d = new Date(prev); d.setDate(d.getDate() - 7); return d; });
  }
  function nextWeek() {
    setWeekStart((prev) => { const d = new Date(prev); d.setDate(d.getDate() + 7); return d; });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[#e6e6e9] bg-white">
      <div className="p-3">
        {/* Week navigation */}
        <div className="mb-3 flex items-center justify-between">
          <button onClick={prevWeek} className="rounded p-1 text-[#8b8d94] transition-colors hover:text-[#1b1b1f]">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-[11px] font-semibold text-[#1b1b1f]">{weekLabel}</span>
          <button onClick={nextWeek} className="rounded p-1 text-[#8b8d94] transition-colors hover:text-[#1b1b1f]">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {weekLoading ? (
          <div className="flex justify-center py-6">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#e6e6e9] border-t-[#6b6f76]" />
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {weekDays.map((day) => {
              const dateKey = toLocalDateKey(day);
              const isPast = dateKey < todayKey;
              const isSelected = selectedDates.includes(dateKey);
              const isToday = dateKey === todayKey;
              const dayEvts = (eventsByDay.get(dateKey) ?? []).sort(
                (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
              );
              const MAX_SHOWN = 4;
              const shown = dayEvts.slice(0, MAX_SHOWN);
              const extra = dayEvts.length - MAX_SHOWN;
              const dayAbbr = day.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2);

              return (
                    <button
                      key={dateKey}
                      disabled={isPast}
                      onClick={() => onToggleDate(dateKey)}
                      className={[
                        "flex flex-col items-center gap-0.5 rounded-lg px-0.5 py-2 transition-colors w-full",
                        isPast ? "cursor-not-allowed opacity-40" : "cursor-pointer",
                        isSelected ? "bg-[#1b1b1f]"
                          : isToday ? "bg-[#f0f0f5] hover:bg-[#e8e8ed]"
                          : !isPast ? "hover:bg-[#f5f5f7]" : "",
                      ].join(" ")}
                    >
                      <span className={["text-[9px] font-medium leading-none", isSelected ? "text-white/70" : "text-[#8b8d94]"].join(" ")}>
                        {dayAbbr}
                      </span>
                      <span className={["text-[13px] font-bold leading-none mb-1", isSelected ? "text-white" : "text-[#1b1b1f]"].join(" ")}>
                        {day.getDate()}
                      </span>
                      {shown.map((e, i) => (
                        <div
                          key={i}
                          className={[
                            "w-full rounded px-0.5 py-px text-[8px] font-medium leading-tight text-center truncate",
                            isSelected ? "bg-white/20 text-white" : "bg-[#e8e8ed] text-[#6b6f76]",
                          ].join(" ")}
                        >
                          {new Date(e.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
                            .replace(":00", "").toLowerCase()}
                        </div>
                      ))}
                      {extra > 0 && (
                        <span className={["text-[8px] leading-none", isSelected ? "text-white/50" : "text-[#8b8d94]"].join(" ")}>
                          +{extra}
                        </span>
                      )}
                      {dayEvts.length === 0 && !isPast && (
                        <span className={["text-[8px] leading-none", isSelected ? "text-white/60" : "text-green-600"].join(" ")}>
                          free
                        </span>
                      )}
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
/*  Find Availability Modal                                             */
/* ------------------------------------------------------------------ */

function FindAvailabilityModal({
  onClose,
  authToken,
  apiBaseUrl,
}: {
  onClose: () => void;
  authToken: string;
  apiBaseUrl: string;
}) {
  const [duration, setDuration] = useState(30);
  const [numSlots, setNumSlots] = useState(3);
  const [mode, setMode] = useState<"auto" | "specific">("auto");
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [results, setResults] = useState<AvailableSlot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
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
        // Auto: next 21 weekdays
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

      let busyEvents: CalendarEvent[] = [];
      try {
        const res = await apiFetch(
          `${apiBaseUrl}/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
        if (res.ok) {
          const data = (await safeJson(res)) as { events: CalendarEvent[] };
          busyEvents = data.events ?? [];
        }
      } catch { /* use empty busy list */ }

      // Group busy periods by local date
      const busyByDay = new Map<string, { start: number; end: number }[]>();
      for (const e of busyEvents) {
        if (e.allDay) continue;
        const key = toLocalDateKey(new Date(e.start));
        if (!busyByDay.has(key)) busyByDay.set(key, []);
        busyByDay.get(key)!.push({
          start: new Date(e.start).getTime(),
          end: new Date(e.end).getTime(),
        });
      }

      const SLOT_MS = duration * 60 * 1000;
      const ROUND_MS = 15 * 60 * 1000;
      const WORK_START_H = 9;
      const WORK_END_H = 18;
      const todayKey = toLocalDateKey(new Date());
      const now = Date.now();
      const found: AvailableSlot[] = [];
      const isSingleDay = mode === "specific" && selectedDates.length === 1;

      if (isSingleDay) {
        // Multiple slots within one day
        const dateKey = datesToCheck[0];
        const [y, mo, d] = dateKey.split("-").map(Number);
        const dayStart = new Date(y, mo - 1, d, WORK_START_H, 0, 0).getTime();
        const dayEnd = new Date(y, mo - 1, d, WORK_END_H, 0, 0).getTime();
        let cursor = dateKey === todayKey
          ? Math.max(dayStart, Math.ceil(now / ROUND_MS) * ROUND_MS)
          : dayStart;
        const busy = (busyByDay.get(dateKey) ?? []).sort((a, b) => a.start - b.start);

        while (cursor + SLOT_MS <= dayEnd && found.length < numSlots) {
          const conflict = busy.find((b) => b.start < cursor + SLOT_MS && b.end > cursor);
          if (!conflict) {
            found.push({ start: new Date(cursor).toISOString(), end: new Date(cursor + SLOT_MS).toISOString() });
            cursor += SLOT_MS;
          } else {
            cursor = Math.ceil(conflict.end / ROUND_MS) * ROUND_MS;
          }
        }
      } else {
        // One slot per day, spread across days
        for (const dateKey of datesToCheck) {
          if (found.length >= numSlots) break;
          const [y, mo, d] = dateKey.split("-").map(Number);
          const dayStart = new Date(y, mo - 1, d, WORK_START_H, 0, 0).getTime();
          const dayEnd = new Date(y, mo - 1, d, WORK_END_H, 0, 0).getTime();
          let cursor = dateKey === todayKey
            ? Math.max(dayStart, Math.ceil(now / ROUND_MS) * ROUND_MS)
            : dayStart;
          const busy = (busyByDay.get(dateKey) ?? []).sort((a, b) => a.start - b.start);

          while (cursor + SLOT_MS <= dayEnd) {
            const conflict = busy.find((b) => b.start < cursor + SLOT_MS && b.end > cursor);
            if (!conflict) {
              found.push({ start: new Date(cursor).toISOString(), end: new Date(cursor + SLOT_MS).toISOString() });
              break;
            }
            cursor = Math.ceil(conflict.end / ROUND_MS) * ROUND_MS;
          }
        }
      }

      setResults(found);
    } finally {
      setLoading(false);
    }
  }

  function formatSlot(slot: AvailableSlot): string {
    const start = new Date(slot.start);
    const end = new Date(slot.end);
    const dateStr = start.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    const startTime = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const endTime = end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `${dateStr} · ${startTime} – ${endTime}`;
  }

  function copySlot(index: number) {
    void navigator.clipboard.writeText(formatSlot(results![index]));
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  }

  function copyAll() {
    const text = results!.map((s, i) => `Option ${i + 1}: ${formatSlot(s)}`).join("\n");
    void navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  }

  const durationOptions = [
    { label: "15 min", value: 15 },
    { label: "30 min", value: 30 },
    { label: "1 hour", value: 60 },
    { label: "90 min", value: 90 },
    { label: "2 hours", value: 120 },
  ];

  const slotsOptions = [1, 2, 3, 4, 5, 6];

  const selectCls = "w-full rounded-md border border-[#e6e6e9] bg-white px-3 py-1.5 text-[12px] font-medium text-[#1b1b1f] focus:outline-none focus:ring-1 focus:ring-[#1b1b1f] appearance-none cursor-pointer";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[500px] overflow-hidden rounded-2xl border border-[#e6e6e9] bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#e6e6e9] px-5 py-4">
          <div className="flex items-center gap-1.5">
            {stage === "results" && (
              <button
                onClick={() => setStage("config")}
                className="-ml-1 rounded-lg p-1.5 text-[#8b8d94] transition-colors hover:bg-[#f5f5f7] hover:text-[#1b1b1f]"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <div>
              <h2 className="text-[15px] font-semibold text-[#1b1b1f]">Find Availability</h2>
              <p className="mt-0.5 text-[12px] text-[#8b8d94]">
                {stage === "config" ? "Find open slots on your calendar" : "Available times"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#8b8d94] transition-colors hover:bg-[#f5f5f7] hover:text-[#1b1b1f]"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[calc(90vh-72px)] space-y-4 overflow-y-auto px-5 py-4">
          {stage === "config" ? (
            <>
              {/* Duration + Slots — one row of dropdowns */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <p className="mb-1.5 text-[12px] font-medium text-[#6b6f76]">Duration</p>
                  <div className="relative">
                    <select
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                      className={selectCls}
                    >
                      {durationOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <svg className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8b8d94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                <div className="flex-1">
                  <p className="mb-1.5 text-[12px] font-medium text-[#6b6f76]">Slots</p>
                  <div className="relative">
                    <select
                      value={numSlots}
                      onChange={(e) => setNumSlots(Number(e.target.value))}
                      className={selectCls}
                    >
                      {slotsOptions.map((n) => (
                        <option key={n} value={n}>{n} slot{n !== 1 ? "s" : ""}</option>
                      ))}
                    </select>
                    <svg className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8b8d94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Time range mode */}
              <div>
                <p className="mb-2 text-[12px] font-medium text-[#6b6f76]">Time range</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setMode("auto"); setSelectedDates([]); }}
                    className={[
                      "flex-1 rounded-md border py-1.5 text-[12px] font-medium transition-colors",
                      mode === "auto"
                        ? "border-[#1b1b1f] bg-[#1b1b1f] text-white"
                        : "border-[#e6e6e9] bg-white text-[#6b6f76] hover:bg-[#f5f5f7]",
                    ].join(" ")}
                  >
                    Next available
                  </button>
                  <button
                    onClick={() => setMode("specific")}
                    className={[
                      "flex-1 rounded-md border py-1.5 text-[12px] font-medium transition-colors",
                      mode === "specific"
                        ? "border-[#1b1b1f] bg-[#1b1b1f] text-white"
                        : "border-[#e6e6e9] bg-white text-[#6b6f76] hover:bg-[#f5f5f7]",
                    ].join(" ")}
                  >
                    Pick dates
                  </button>
                </div>

                {mode === "specific" && (
                  <div className="mt-3">
                    <AvailabilityCalendar selectedDates={selectedDates} onToggleDate={toggleDate} authToken={authToken} apiBaseUrl={apiBaseUrl} />
                    {selectedDates.length > 0 && (
                      <p className="mt-2 text-[11px] text-[#8b8d94]">
                        {selectedDates.length} date{selectedDates.length !== 1 ? "s" : ""} selected
                        {selectedDates.length === 1 ? " — will find multiple slots on this day" : ""}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Next button */}
              <button
                onClick={() => void handleFind()}
                disabled={mode === "specific" && selectedDates.length === 0}
                className="w-full rounded-lg bg-[#1b1b1f] py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#2d2d33] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </>
          ) : (
            /* Results stage */
            <>
              {loading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-10">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#e6e6e9] border-t-[#1b1b1f]" />
                  <p className="text-[12px] text-[#8b8d94]">Finding slots…</p>
                </div>
              ) : results !== null && results.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-[#8b8d94]">
                  No open slots found in the selected range.
                </p>
              ) : results !== null ? (
                <>
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-[12px] font-medium text-[#6b6f76]">
                      {results.length} slot{results.length !== 1 ? "s" : ""} found
                    </p>
                    <button
                      onClick={copyAll}
                      className={[
                        "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
                        copiedAll
                          ? "border-green-200 bg-green-50 text-green-700"
                          : "border-[#e6e6e9] text-[#6b6f76] hover:bg-[#f5f5f7]",
                      ].join(" ")}
                    >
                      {copiedAll ? "Copied!" : "Copy all"}
                    </button>
                  </div>

                  <div className="space-y-2">
                    {results.map((slot, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-3 rounded-lg border border-[#e6e6e9] bg-[#f9f9fb] px-3.5 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8b8d94]">
                            Option {i + 1}
                          </p>
                          <p className="mt-0.5 truncate text-[13px] font-medium text-[#1b1b1f]">
                            {formatSlot(slot)}
                          </p>
                        </div>
                        <button
                          onClick={() => copySlot(i)}
                          className={[
                            "shrink-0 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                            copiedIndex === i
                              ? "border-green-200 bg-green-50 text-green-700"
                              : "border-[#e6e6e9] bg-white text-[#6b6f76] hover:bg-[#f5f5f7]",
                          ].join(" ")}
                        >
                          {copiedIndex === i ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
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
    <div className="rounded-lg border border-[#e6e6e9] bg-white px-3.5 py-2.5 transition-all hover:border-[#d4d4d8]">
      {/* Top row: title + actions */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[14px] font-semibold text-[#1b1b1f] truncate">{event.summary}</p>
          </div>
          <div className="mt-0.5 flex items-center gap-2 flex-wrap text-[12px] text-[#8b8d94]">
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
              className="flex items-center gap-1 rounded-md bg-[#eef0ff] px-2.5 py-1 text-[11px] font-medium text-[#5e6ad2] hover:bg-[#e4e7ff] transition-colors"
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
              className="text-[11px] text-[#8b8d94] hover:text-[#6b6f76] transition-colors"
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
                <p className="text-[13px] font-medium text-[#1b1b1f] truncate">{person.name}</p>
                <div className="flex items-center gap-1.5 text-[11px] text-[#8b8d94]">
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
        <p className="mt-2 text-[11px] text-[#8b8d94]">
          +{event.attendees.length - matched.length} other attendee{event.attendees.length - matched.length !== 1 ? "s" : ""}
        </p>
      )}

      {/* Synced from indicator */}
      {sourceUser && (
        <div className="mt-2 flex items-center gap-1 group/source">
          <span className="text-[10px] text-[#8b8d94]">Synced from</span>
          <div className="relative">
            <FallbackImg src={sourceUser.profilePhotoUrl} className="h-3.5 w-3.5 rounded-full object-cover">
              <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#e6e6e9] text-[7px] font-bold text-[#6b6f76]">
                {sourceUser.name.charAt(0).toUpperCase()}
              </div>
            </FallbackImg>
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/source:block">
              <div className="whitespace-nowrap rounded bg-[#1b1b1f] px-2 py-1 text-[10px] text-white shadow-lg">
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
  const [showFindAvail, setShowFindAvail] = useState(false);
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
          <p className="text-[13px] text-[#6b6f76] leading-relaxed">
            Meetings with your tracked people and companies. Only calendar events with at least one tracked person are shown.
          </p>

          {/* Controls: month nav + actions */}
          {connected && (
            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={prevMonth}
                  className="rounded-md border border-[#e6e6e9] bg-white p-1.5 text-[#8b8d94] hover:bg-[#f5f5f7] hover:text-[#6b6f76] transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <span className="min-w-[160px] text-center text-[13px] font-semibold text-[#1b1b1f]">{monthLabel}</span>
                <button
                  onClick={nextMonth}
                  className="rounded-md border border-[#e6e6e9] bg-white p-1.5 text-[#8b8d94] hover:bg-[#f5f5f7] hover:text-[#6b6f76] transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <span className="ml-2 text-[12px] text-[#8b8d94]">
                  {meetings.length} meeting{meetings.length !== 1 ? "s" : ""}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowFindAvail(true)}
                  className="flex items-center gap-1.5 rounded-md border border-[#e6e6e9] bg-white px-3 py-1.5 text-[13px] font-medium text-[#6b6f76] transition-all hover:bg-[#f5f5f7]"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Find Availability
                </button>

                <button
                  onClick={() => { if (authToken) void fetchEvents(authToken, year, month, true); }}
                  disabled={refreshing}
                  className="flex items-center gap-1.5 rounded-md border border-[#e6e6e9] bg-white px-3 py-1.5 text-[13px] font-medium text-[#6b6f76] transition-all hover:bg-[#f5f5f7] disabled:opacity-50"
                >
                  {refreshing ? (
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#e6e6e9] border-t-[#6b6f76]" />
                  ) : (
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                    </svg>
                  )}
                  Refresh
                </button>
              </div>
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
                  <p className="text-[14px] text-[#8b8d94]">Google Calendar not connected</p>
                  <button
                    onClick={connectGoogle}
                    className="rounded-md border border-[#e6e6e9] bg-white px-4 py-2 text-[13px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7]"
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
                <p className="text-[14px] text-[#8b8d94]">No meetings with tracked people in {monthLabel}</p>
              </div>
            ) : (
              <div className="space-y-6">
                {grouped.map(([dateKey, dayEvents]) => (
                  <div key={dateKey}>
                    {/* Date heading */}
                    <div className="mb-3 flex items-center gap-3">
                      <div className={`flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg text-center ${isSameDay(dateKey) ? "bg-[#1b1b1f] text-white" : "bg-white border border-[#e6e6e9] text-[#6b6f76]"}`}>
                        <span className="text-[10px] font-semibold uppercase leading-none tracking-wide">
                          {new Date(dateKey + "T12:00:00Z").toLocaleDateString("en-US", { month: "short" })}
                        </span>
                        <span className="text-[15px] font-bold leading-tight">
                          {new Date(dateKey + "T12:00:00Z").getDate()}
                        </span>
                      </div>
                      <div>
                        <p className={`text-[13px] font-semibold ${isSameDay(dateKey) ? "text-[#1b1b1f]" : "text-[#6b6f76]"}`}>
                          {formatDateHeading(dateKey)}
                        </p>
                        <p className="text-[11px] text-[#8b8d94]">
                          {dayEvents.length} meeting{dayEvents.length !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>

                    {/* Events */}
                    <div className="ml-12 space-y-2">
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

      {showFindAvail && (
        <FindAvailabilityModal
          onClose={() => setShowFindAvail(false)}
          authToken={authToken}
          apiBaseUrl={apiBaseUrl}
        />
      )}
    </div>
  );
}
