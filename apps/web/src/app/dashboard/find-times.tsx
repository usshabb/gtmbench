"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, safeJson } from "./components";

const DEFAULT_ZOOM_LINK = "https://us06web.zoom.us/j/3770048360?pwd=WnEySWliaFFxRHUwalBZMFNBcllXUT09";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

interface FoundSlot { start: string; end: string }

function buildGoogleCalendarLink(
  slot: FoundSlot,
  title: string,
  description: string,
  attendeeEmails: string[],
): string {
  const start = new Date(slot.start).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = new Date(slot.end).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${start}/${end}`,
    details: description,
    add: attendeeEmails.join(","),
  });
  return `https://calendar.google.com/calendar/event?${params.toString()}`;
}

function formatSlotDisplay(slot: FoundSlot): string {
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  const dateStr = start.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const startTime = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  const endTime = end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  return `${dateStr}, ${startTime} – ${endTime} EST`;
}

/**
 * Inline dropdown for finding available meeting times.
 * Used in email compose modals to insert calendar deep links into the email body.
 */
export function FindTimesDropdown({
  authToken,
  recipientEmail,
  recipientName,
  recipientCompany,
  onInsert,
}: {
  authToken: string;
  recipientEmail: string;
  recipientName?: string;
  recipientCompany?: string;
  onInsert: (text: string) => void;
}) {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"next_available" | "select_dates">("next_available");
  const [numSlots, setNumSlots] = useState(3);
  const [durationMin, setDurationMin] = useState(30);
  const [loading, setLoading] = useState(false);
  const [foundSlots, setFoundSlots] = useState<FoundSlot[] | null>(null);
  const [zoomLink, setZoomLink] = useState(DEFAULT_ZOOM_LINK);

  // Date picker for select_dates mode
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [datePickerMonth, setDatePickerMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // User info
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const fetchedUserRef = useRef(false);

  useEffect(() => {
    if (!authToken || fetchedUserRef.current) return;
    fetchedUserRef.current = true;
    void apiFetch(`${apiBaseUrl}/me`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await safeJson(res)) as { email: string; user?: { fullName?: string | null } };
        setUserEmail(data.email);
        setUserName(data.user?.fullName?.split(" ")[0] ?? data.email.split("@")[0]);
      })
      .catch(() => {});
  }, [authToken, apiBaseUrl]);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function getMeetingTitle(): string {
    const first = (recipientName ?? "").split(" ")[0] || "them";
    const company = recipientCompany ? ` - ${recipientCompany}` : "";
    return `${userName || "Me"} <> ${first}${company}`;
  }

  function getSlotLink(slot: FoundSlot): string {
    const title = getMeetingTitle();
    const description = `Zoom Link: ${zoomLink}`;
    const attendees = [userEmail, recipientEmail].filter(Boolean);
    return buildGoogleCalendarLink(slot, title, description, attendees);
  }

  async function findSlots() {
    setLoading(true);
    setFoundSlots(null);
    try {
      const body: Record<string, unknown> = { mode, numSlots, durationMin };
      if (mode === "select_dates") {
        body.dates = Array.from(selectedDates).sort();
      }
      const res = await apiFetch(`${apiBaseUrl}/calendar/find-slots`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await safeJson(res)) as { slots: FoundSlot[] };
      setFoundSlots(data.slots ?? []);
    } catch {
      setFoundSlots([]);
    } finally {
      setLoading(false);
    }
  }

  function insertIntoEmail() {
    if (!foundSlots || foundSlots.length === 0) return;
    const lines = foundSlots.map((slot, i) => {
      const display = formatSlotDisplay(slot);
      const link = getSlotLink(slot);
      return `${i + 1}. <a href="${link}">${display}</a>`;
    });
    const html = `<p><br></p><p>Here are a few times that work for me:</p><p><br></p>${lines.map((l) => `<p>${l}</p>`).join("")}<p><br></p><p>Zoom: <a href="${zoomLink}">${zoomLink}</a></p>`;
    onInsert(html);
    setOpen(false);
    setFoundSlots(null);
  }

  // Mini calendar for date selection
  const calendarDays = useMemo(() => {
    const { year, month } = datePickerMonth;
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < (firstDay === 0 ? 6 : firstDay - 1); i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(d);
    return days;
  }, [datePickerMonth]);

  function toggleDate(day: number) {
    const { year, month } = datePickerMonth;
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr);
      else next.add(dateStr);
      return next;
    });
  }

  function isDateSelected(day: number): boolean {
    const { year, month } = datePickerMonth;
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return selectedDates.has(dateStr);
  }

  function isPast(day: number): boolean {
    const { year, month } = datePickerMonth;
    const d = new Date(year, month, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d < today;
  }

  function isWeekend(day: number): boolean {
    const { year, month } = datePickerMonth;
    const dow = new Date(year, month, day).getDay();
    return dow === 0 || dow === 6;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Find available times"
        className="rounded p-1.5 text-[#6b6f76] hover:bg-[#f5f5f7] hover:text-[#1a1f36] transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
    );
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(false)}
        title="Find available times"
        className="rounded p-1.5 bg-[#eef0ff] text-[#5e6ad2] transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>

      <div className="absolute bottom-full left-0 mb-2 w-[380px] rounded-lg border border-[#e6e6e9] bg-white shadow-xl z-30 overflow-hidden">
        <div className="px-4 py-3 border-b border-[#e6e6e9] flex items-center justify-between">
          <span className="text-[13px] font-semibold text-[#1b1b1f]">Find Times</span>
          <button onClick={() => setOpen(false)} className="text-[#8b8d94] hover:text-[#6b6f76]">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-4 py-3 space-y-3 max-h-[420px] overflow-y-auto">
          {/* Config row */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] text-[#8b8d94]">Slots</label>
              <select
                value={numSlots}
                onChange={(e) => setNumSlots(Number(e.target.value))}
                className="rounded border border-[#e6e6e9] bg-white px-1.5 py-0.5 text-[12px] text-[#1b1b1f]"
              >
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] text-[#8b8d94]">Duration</label>
              <select
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
                className="rounded border border-[#e6e6e9] bg-white px-1.5 py-0.5 text-[12px] text-[#1b1b1f]"
              >
                {[15, 30, 45, 60, 90].map((n) => <option key={n} value={n}>{n}m</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] text-[#8b8d94]">Mode</label>
              <select
                value={mode}
                onChange={(e) => { setMode(e.target.value as "next_available" | "select_dates"); setFoundSlots(null); }}
                className="rounded border border-[#e6e6e9] bg-white px-1.5 py-0.5 text-[12px] text-[#1b1b1f]"
              >
                <option value="next_available">Next Available</option>
                <option value="select_dates">Select Dates</option>
              </select>
            </div>
          </div>

          {/* Zoom link */}
          <div>
            <label className="text-[11px] text-[#8b8d94] mb-1 block">Zoom Link</label>
            <input
              type="text"
              value={zoomLink}
              onChange={(e) => setZoomLink(e.target.value)}
              className="w-full rounded border border-[#e6e6e9] px-2 py-1 text-[12px] text-[#1b1b1f] focus:outline-none focus:border-[#5e6ad2]"
            />
          </div>

          {/* Date picker for select_dates mode */}
          {mode === "select_dates" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => setDatePickerMonth((p) => {
                    if (p.month === 0) return { year: p.year - 1, month: 11 };
                    return { ...p, month: p.month - 1 };
                  })}
                  className="rounded p-0.5 text-[#8b8d94] hover:bg-[#f5f5f7]"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <span className="text-[12px] font-medium text-[#6b6f76]">
                  {new Date(datePickerMonth.year, datePickerMonth.month).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                </span>
                <button
                  onClick={() => setDatePickerMonth((p) => {
                    if (p.month === 11) return { year: p.year + 1, month: 0 };
                    return { ...p, month: p.month + 1 };
                  })}
                  className="rounded p-0.5 text-[#8b8d94] hover:bg-[#f5f5f7]"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
              <div className="grid grid-cols-7 gap-0.5 text-center">
                {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
                  <div key={d} className="text-[10px] font-medium text-[#8b8d94] py-1">{d}</div>
                ))}
                {calendarDays.map((day, i) => (
                  <div key={i}>
                    {day === null ? (
                      <div className="h-7" />
                    ) : (
                      <button
                        type="button"
                        disabled={isPast(day) || isWeekend(day)}
                        onClick={() => toggleDate(day)}
                        className={`h-7 w-full rounded text-[11px] transition-colors ${
                          isDateSelected(day)
                            ? "bg-[#5e6ad2] text-white font-medium"
                            : isPast(day) || isWeekend(day)
                            ? "text-[#d0d0d4] cursor-not-allowed"
                            : "text-[#1b1b1f] hover:bg-[#eef0ff]"
                        }`}
                      >
                        {day}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {selectedDates.size > 0 && (
                <p className="mt-1.5 text-[11px] text-[#8b8d94]">{selectedDates.size} date{selectedDates.size !== 1 ? "s" : ""} selected</p>
              )}
            </div>
          )}

          {/* Find button */}
          <button
            onClick={findSlots}
            disabled={loading || (mode === "select_dates" && selectedDates.size === 0)}
            className="w-full rounded-md bg-[#1b1b1f] py-1.5 text-[12px] font-medium text-white hover:bg-[#2d2d33] disabled:opacity-40 transition-colors"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-1.5">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
                Finding…
              </span>
            ) : (
              `Find ${numSlots} Slot${numSlots !== 1 ? "s" : ""}`
            )}
          </button>

          {/* Results */}
          {foundSlots !== null && (
            <div>
              {foundSlots.length === 0 ? (
                <p className="text-[12px] text-[#8b8d94] text-center py-2">No slots found. Try different options.</p>
              ) : (
                <div className="space-y-1.5">
                  {foundSlots.map((slot, i) => (
                    <div key={i} className="flex items-center gap-2 rounded border border-[#e6e6e9] bg-[#fafafa] px-2.5 py-1.5">
                      <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#eef0ff] text-[9px] font-bold text-[#5e6ad2]">
                        {i + 1}
                      </div>
                      <span className="flex-1 text-[11px] text-[#1b1b1f] truncate">{formatSlotDisplay(slot)}</span>
                    </div>
                  ))}
                  <button
                    onClick={insertIntoEmail}
                    className="w-full mt-1 flex items-center justify-center gap-1.5 rounded-md bg-[#5e6ad2] py-1.5 text-[12px] font-medium text-white hover:bg-[#4f5bc4] transition-colors"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Insert into Email
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
