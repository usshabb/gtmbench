"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LetterAvatar, safeJson, apiFetch } from "../components";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface PersonMeta {
  email: string;
  name: string;
  personId: string;
  companyDomain?: string;
  companyName?: string;
  profilePic?: string;
}

interface InboxThread {
  id: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  personEmail: string;
  personName?: string;
  sourceUserEmail?: string;
  sourceUserName?: string;
  isUnread: boolean;
}

type FilterItem =
  | { type: "person"; email: string; name: string }
  | { type: "company"; domain: string; name: string };

interface ThreadMessage {
  id: string;
  from: string;
  to: string;
  cc?: string;
  subject: string;
  date: string;
  body: string;
  isUnread: boolean;
  messageId?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const isThisYear = d.getFullYear() === now.getFullYear();
  if (isToday) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (isThisYear) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function parseDisplayName(emailHeader: string): { name: string; address: string } {
  const match = emailHeader.match(/^"?([^"<]+?)"?\s*<([^>]+)>$/);
  if (match) return { name: match[1].trim(), address: match[2].trim() };
  return { name: emailHeader.trim(), address: emailHeader.trim() };
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? "?";
  return ((parts[0][0] ?? "") + (parts[parts.length - 1][0] ?? "")).toUpperCase();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ThreadRow({
  thread,
  selected,
  isRead,
  onClick,
  profilePic,
}: {
  thread: InboxThread;
  selected: boolean;
  isRead: boolean;
  onClick: () => void;
  profilePic?: string;
}) {
  const { name: fromName } = parseDisplayName(thread.from);
  const displayName = thread.personName ?? fromName;
  const unread = thread.isUnread && !isRead;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors border-b border-zinc-100 ${
        selected ? "bg-zinc-100" : "hover:bg-zinc-50"
      }`}
    >
      {/* Unread dot */}
      <div className="mt-1.5 shrink-0 w-1.5">
        {unread && <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />}
      </div>

      {/* Avatar */}
      <div className="shrink-0">
        <LetterAvatar name={displayName} size="sm" src={profilePic} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-[13px] ${unread ? "font-semibold text-zinc-900" : "font-medium text-zinc-700"}`}>
            {displayName}
          </span>
          <span className="shrink-0 text-[11px] text-zinc-400">{formatDate(thread.date)}</span>
        </div>
        <p className={`mt-0.5 truncate text-[12px] ${unread ? "font-medium text-zinc-700" : "text-zinc-500"}`}>
          {thread.subject}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-zinc-400">{thread.snippet}</p>
      </div>
    </button>
  );
}

function MessageBubble({
  msg,
  myEmails,
}: {
  msg: ThreadMessage;
  myEmails: string[];
}) {
  const { name: fromName, address: fromAddress } = parseDisplayName(msg.from);
  const isMine = myEmails.some((e) => fromAddress.toLowerCase().includes(e.toLowerCase()));
  const [expanded, setExpanded] = useState(true);

  return (
    <div className={`flex gap-3 ${isMine ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div className="shrink-0">
        <div className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold ${
          isMine ? "bg-zinc-800 text-white" : "bg-zinc-100 text-zinc-600"
        }`}>
          {getInitials(fromName)}
        </div>
      </div>

      {/* Bubble */}
      <div className={`min-w-0 max-w-[75%] ${isMine ? "items-end" : "items-start"} flex flex-col`}>
        {/* Header */}
        <div className={`flex items-center gap-2 mb-1 ${isMine ? "flex-row-reverse" : ""}`}>
          <span className="text-[12px] font-semibold text-zinc-700">{fromName}</span>
          <span className="text-[11px] text-zinc-400">{formatDate(msg.date)}</span>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[11px] text-zinc-400 hover:text-zinc-600"
          >
            {expanded ? "▴" : "▾"}
          </button>
        </div>

        {expanded && (
          <>
            {/* To/Cc meta */}
            <div className="mb-2 text-[11px] text-zinc-400">
              <span>To: {msg.to}</span>
              {msg.cc && <span className="ml-2">Cc: {msg.cc}</span>}
            </div>

            {/* Body */}
            <div className={`rounded-2xl px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap break-words ${
              isMine
                ? "bg-zinc-800 text-white rounded-tr-sm"
                : "bg-zinc-100 text-zinc-800 rounded-tl-sm"
            }`}>
              {msg.body || <span className="italic opacity-50">No content</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InboxPage() {
  return (
    <Suspense>
      <InboxInner />
    </Suspense>
  );
}

function InboxInner() {
  const router = useRouter();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  // Auth + connectivity
  const [authToken, setAuthToken] = useState("");
  const [gmailConnected, setGmailConnected] = useState(false);

  // Thread list
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [personEmails, setPersonEmails] = useState<PersonMeta[]>([]);
  const [connectedUsers, setConnectedUsers] = useState<{ email: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Locally-read thread IDs (so opened threads show as read immediately)
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [tabFilter, setTabFilter] = useState<"all" | "unread">("all");
  const [activeFilters, setActiveFilters] = useState<FilterItem[]>([]);

  // Filter dropdown state
  const [showFilter, setShowFilter] = useState(false);
  const [filterPanel, setFilterPanel] = useState<"main" | "people" | "company">("main");
  const [panelSearch, setPanelSearch] = useState("");
  const filterRef = useRef<HTMLDivElement>(null);

  // Thread detail
  const [selectedThread, setSelectedThread] = useState<InboxThread | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Reply
  const [replyBody, setReplyBody] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionAnchorPos, setMentionAnchorPos] = useState(0);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const checkedRef = useRef(false);

  // Close filter dropdown on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilter(false);
        setFilterPanel("main");
        setPanelSearch("");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // ── Fetch ────────────────────────────────────────────────────────────────

  const fetchInbox = useCallback(async (token: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`${apiBaseUrl}/inbox/emails`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = (await safeJson(res)) as { error?: string };
        throw new Error(data.error ?? "Failed to fetch inbox");
      }
      const data = (await safeJson(res)) as {
        threads: InboxThread[];
        personEmails: PersonMeta[];
        connectedUsers?: { email: string; name: string }[];
      };
      setThreads(data.threads ?? []);
      setPersonEmails(data.personEmails ?? []);
      setConnectedUsers(data.connectedUsers ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inbox");
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    const token = window.localStorage.getItem(localStorageTokenKey);
    if (!token) { router.replace("/"); return; }
    setAuthToken(token);
    if (checkedRef.current) return;
    checkedRef.current = true;

    void apiFetch(`${apiBaseUrl}/gmail/status`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = (await safeJson(res)) as { connected: boolean };
        setGmailConnected(data.connected);
        if (data.connected) void fetchInbox(token);
        else setLoading(false);
      })
      .catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to bottom when messages load
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Thread selection ──────────────────────────────────────────────────────

  async function selectThread(thread: InboxThread) {
    setSelectedThread(thread);
    setMessages([]);
    setReplyBody("");
    setMentionQuery(null);
    setLoadingMessages(true);
    setReadIds((prev) => new Set([...prev, thread.id]));

    // Mark as read in Gmail
    if (thread.isUnread) {
      void apiFetch(`${apiBaseUrl}/inbox/threads/${thread.id}/read`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sourceUserEmail: thread.sourceUserEmail }),
      }).then(() => {
        // Update thread's isUnread flag locally so it stays read on re-render
        setThreads((prev) =>
          prev.map((t) => (t.id === thread.id ? { ...t, isUnread: false } : t)),
        );
      }).catch(() => { /* ignore */ });
    }

    try {
      const qs = thread.sourceUserEmail
        ? `?sourceUserEmail=${encodeURIComponent(thread.sourceUserEmail)}`
        : "";
      const res = await apiFetch(`${apiBaseUrl}/inbox/threads/${thread.id}${qs}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = (await safeJson(res)) as { messages?: ThreadMessage[] };
      setMessages(data.messages ?? []);
    } catch {
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }

  // ── Reply ─────────────────────────────────────────────────────────────────

  function handleReplyChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setReplyBody(val);

    // Detect @ mention
    const cursor = e.target.selectionStart ?? val.length;
    const before = val.slice(0, cursor);
    const atIdx = before.lastIndexOf("@");
    if (atIdx !== -1 && !before.slice(atIdx).includes(" ")) {
      setMentionQuery(before.slice(atIdx + 1));
      setMentionAnchorPos(atIdx);
    } else {
      setMentionQuery(null);
    }
  }

  function insertMention(member: { email: string; name: string }) {
    const ta = replyRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart ?? replyBody.length;
    const before = replyBody.slice(0, mentionAnchorPos);
    const after = replyBody.slice(cursor);
    const tag = `@${member.name} `;
    const next = before + tag + after;
    setReplyBody(next);
    setMentionQuery(null);
    setTimeout(() => {
      ta.focus();
      const pos = before.length + tag.length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  }

  async function sendReply() {
    if (!selectedThread || !replyBody.trim() || sendingReply) return;
    setSendingReply(true);
    try {
      const lastMsg = messages[messages.length - 1];
      await apiFetch(`${apiBaseUrl}/inbox/threads/${selectedThread.id}/reply`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: selectedThread.personEmail,
          subject: selectedThread.subject,
          body: replyBody,
          sourceUserEmail: selectedThread.sourceUserEmail,
          inReplyTo: lastMsg?.messageId,
        }),
      });
      setReplyBody("");
      setMentionQuery(null);
      // Reload thread messages
      await selectThread(selectedThread);
    } catch {
      // ignore
    } finally {
      setSendingReply(false);
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const myEmails = useMemo(() => connectedUsers.map((u) => u.email), [connectedUsers]);

  const profilePicMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of personEmails) {
      if (p.profilePic) map.set(p.email.toLowerCase(), p.profilePic);
    }
    return map;
  }, [personEmails]);

  // Derive unique companies from persons
  const companies = useMemo(() => {
    const map = new Map<string, { domain: string; name: string }>();
    for (const p of personEmails) {
      if (!p.companyDomain || map.has(p.companyDomain)) continue;
      map.set(p.companyDomain, { domain: p.companyDomain, name: p.companyName ?? p.companyDomain });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [personEmails]);

  // Helper: is a filter active?
  function isFilterActive(item: FilterItem) {
    return activeFilters.some((f) =>
      f.type === item.type &&
      (f.type === "person" && item.type === "person" ? f.email === item.email :
       f.type === "company" && item.type === "company" ? f.domain === item.domain : false),
    );
  }

  function toggleFilter(item: FilterItem) {
    setActiveFilters((prev) => {
      const active = prev.some((f) =>
        f.type === item.type &&
        (f.type === "person" && item.type === "person" ? f.email === item.email :
         f.type === "company" && item.type === "company" ? f.domain === item.domain : false),
      );
      if (active) return prev.filter((f) => !(f.type === item.type && JSON.stringify(f) === JSON.stringify(item)));
      return [...prev, item];
    });
  }

  const deduped = useMemo(() => {
    const seen = new Set<string>();
    return threads.filter((t) => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });
  }, [threads]);

  const filtered = useMemo(() => {
    let result = deduped;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.subject.toLowerCase().includes(q) ||
          t.snippet.toLowerCase().includes(q) ||
          (t.personName ?? "").toLowerCase().includes(q) ||
          t.personEmail.toLowerCase().includes(q),
      );
    }

    if (tabFilter === "unread") {
      result = result.filter((t) => t.isUnread && !readIds.has(t.id));
    }

    if (activeFilters.length > 0) {
      const personFilters = activeFilters.filter((f): f is Extract<FilterItem, { type: "person" }> => f.type === "person");
      const companyFilters = activeFilters.filter((f): f is Extract<FilterItem, { type: "company" }> => f.type === "company");

      result = result.filter((t) => {
        const personMeta = personEmails.find((p) => p.email.toLowerCase() === t.personEmail.toLowerCase());
        const matchesPerson = personFilters.length === 0 || personFilters.some((f) => f.email.toLowerCase() === t.personEmail.toLowerCase());
        const matchesCompany = companyFilters.length === 0 || companyFilters.some((f) => personMeta?.companyDomain === f.domain);
        return matchesPerson && matchesCompany;
      });
    }

    return result;
  }, [deduped, searchQuery, tabFilter, activeFilters, readIds, personEmails]);

  const unreadCount = useMemo(
    () => deduped.filter((t) => t.isUnread && !readIds.has(t.id)).length,
    [deduped, readIds],
  );

  const filteredMentionMembers = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return connectedUsers.filter(
      (m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    );
  }, [mentionQuery, connectedUsers]);

  // ── Connect Gmail ─────────────────────────────────────────────────────────

  async function connectGmail() {
    const res = await apiFetch(`${apiBaseUrl}/auth/google/url?returnPath=/dashboard/inbox`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = (await safeJson(res)) as { url: string };
    if (data.url) window.location.href = data.url;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
      </div>
    );
  }

  if (!gmailConnected) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <p className="text-[14px] text-black/40">Gmail not connected</p>
          <button
            onClick={connectGmail}
            className="rounded-lg border border-black/[0.08] px-4 py-2 text-[13px] font-medium text-black/70 hover:bg-black/[0.03]"
          >
            Connect Gmail
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[13px] text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden bg-white">

      {/* ── Left panel: thread list ─────────────────────────────────────── */}
      <div className="flex w-[300px] shrink-0 flex-col border-r border-zinc-150 overflow-hidden">

        {/* Search + Filter button */}
        <div className="border-b border-zinc-100 px-3 py-3">
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-lg bg-zinc-100 px-3 py-2">
              <svg className="h-3.5 w-3.5 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-zinc-800 placeholder:text-zinc-400 outline-none"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="text-zinc-400 hover:text-zinc-600">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Filter button */}
            <div className="relative" ref={filterRef}>
              <button
                onClick={() => { setShowFilter((v) => !v); setFilterPanel("main"); setPanelSearch(""); }}
                className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                  showFilter || activeFilters.length > 0
                    ? "bg-zinc-900 text-white"
                    : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                }`}
              >
                {activeFilters.length > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[9px] font-bold text-white">
                    {activeFilters.length}
                  </span>
                )}
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
              </button>

              {/* Dropdown */}
              {showFilter && (
                <div className="absolute right-0 top-full mt-1 w-64 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl z-30">

                  {/* Main panel */}
                  {filterPanel === "main" && (
                    <div>
                      <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 border-b border-zinc-100">
                        Filter by
                      </div>
                      <button
                        onClick={() => { setFilterPanel("people"); setPanelSearch(""); }}
                        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-zinc-50 transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          <svg className="h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                          </svg>
                          <span className="text-[13px] font-medium text-zinc-700">People</span>
                          {activeFilters.filter((f) => f.type === "person").length > 0 && (
                            <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              {activeFilters.filter((f) => f.type === "person").length}
                            </span>
                          )}
                        </div>
                        <svg className="h-3.5 w-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                      </button>
                      <button
                        onClick={() => { setFilterPanel("company"); setPanelSearch(""); }}
                        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-zinc-50 transition-colors border-t border-zinc-100"
                      >
                        <div className="flex items-center gap-2.5">
                          <svg className="h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
                          </svg>
                          <span className="text-[13px] font-medium text-zinc-700">Company</span>
                          {activeFilters.filter((f) => f.type === "company").length > 0 && (
                            <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              {activeFilters.filter((f) => f.type === "company").length}
                            </span>
                          )}
                        </div>
                        <svg className="h-3.5 w-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                      </button>
                      {activeFilters.length > 0 && (
                        <button
                          onClick={() => { setActiveFilters([]); setShowFilter(false); }}
                          className="flex w-full items-center justify-center px-4 py-2.5 text-[12px] font-medium text-red-500 hover:bg-red-50 border-t border-zinc-100 transition-colors"
                        >
                          Clear all filters
                        </button>
                      )}
                    </div>
                  )}

                  {/* People sub-panel */}
                  {filterPanel === "people" && (
                    <div>
                      <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2">
                        <button
                          onClick={() => setFilterPanel("main")}
                          className="text-zinc-400 hover:text-zinc-600"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                          </svg>
                        </button>
                        <input
                          autoFocus
                          type="text"
                          value={panelSearch}
                          onChange={(e) => setPanelSearch(e.target.value)}
                          placeholder="Search people…"
                          className="flex-1 text-[12px] text-zinc-800 placeholder:text-zinc-400 outline-none"
                        />
                      </div>
                      <div className="max-h-56 overflow-y-auto">
                        {personEmails
                          .filter((p) => !panelSearch || p.name.toLowerCase().includes(panelSearch.toLowerCase()) || p.email.toLowerCase().includes(panelSearch.toLowerCase()))
                          .map((p) => {
                            const item: FilterItem = { type: "person", email: p.email, name: p.name };
                            const active = isFilterActive(item);
                            return (
                              <button
                                key={p.email}
                                onClick={() => toggleFilter(item)}
                                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-50 transition-colors"
                              >
                                <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${active ? "border-zinc-900 bg-zinc-900" : "border-zinc-300"}`}>
                                  {active && (
                                    <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                    </svg>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-[12px] font-medium text-zinc-800">{p.name}</p>
                                  <p className="truncate text-[11px] text-zinc-400">{p.email}</p>
                                </div>
                              </button>
                            );
                          })}
                        {personEmails.filter((p) => !panelSearch || p.name.toLowerCase().includes(panelSearch.toLowerCase())).length === 0 && (
                          <p className="px-4 py-4 text-[12px] text-zinc-400">No people found</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Company sub-panel */}
                  {filterPanel === "company" && (
                    <div>
                      <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2">
                        <button
                          onClick={() => setFilterPanel("main")}
                          className="text-zinc-400 hover:text-zinc-600"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                          </svg>
                        </button>
                        <input
                          autoFocus
                          type="text"
                          value={panelSearch}
                          onChange={(e) => setPanelSearch(e.target.value)}
                          placeholder="Search companies…"
                          className="flex-1 text-[12px] text-zinc-800 placeholder:text-zinc-400 outline-none"
                        />
                      </div>
                      <div className="max-h-56 overflow-y-auto">
                        {companies
                          .filter((c) => !panelSearch || c.name.toLowerCase().includes(panelSearch.toLowerCase()) || c.domain.toLowerCase().includes(panelSearch.toLowerCase()))
                          .map((c) => {
                            const item: FilterItem = { type: "company", domain: c.domain, name: c.name };
                            const active = isFilterActive(item);
                            return (
                              <button
                                key={c.domain}
                                onClick={() => toggleFilter(item)}
                                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-50 transition-colors"
                              >
                                <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${active ? "border-zinc-900 bg-zinc-900" : "border-zinc-300"}`}>
                                  {active && (
                                    <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                    </svg>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-[12px] font-medium text-zinc-800">{c.name}</p>
                                  <p className="truncate text-[11px] text-zinc-400">{c.domain}</p>
                                </div>
                              </button>
                            );
                          })}
                        {companies.filter((c) => !panelSearch || c.name.toLowerCase().includes(panelSearch.toLowerCase())).length === 0 && (
                          <p className="px-4 py-4 text-[12px] text-zinc-400">No companies found</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Read / Unread tabs */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-100">
          <button
            onClick={() => setTabFilter("all")}
            className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
              tabFilter === "all"
                ? "bg-zinc-900 text-white"
                : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setTabFilter("unread")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
              tabFilter === "unread"
                ? "bg-zinc-900 text-white"
                : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
            }`}
          >
            Unread
            {unreadCount > 0 && (
              <span className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
                tabFilter === "unread" ? "bg-white/20 text-white" : "bg-zinc-300 text-zinc-600"
              }`}>
                {unreadCount}
              </span>
            )}
          </button>
        </div>

        {/* Active filter pills */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-zinc-100">
            {activeFilters.map((f, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full bg-zinc-800 pl-2.5 pr-1.5 py-0.5 text-[11px] font-medium text-white"
              >
                {f.type === "person" ? f.name : f.name}
                <button
                  onClick={() => toggleFilter(f)}
                  className="flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-white/20 transition-colors"
                >
                  <svg className="h-2 w-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-[13px] text-zinc-400">No emails found</p>
            </div>
          ) : (
            filtered.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                selected={selectedThread?.id === thread.id}
                isRead={readIds.has(thread.id)}
                onClick={() => selectThread(thread)}
                profilePic={profilePicMap.get(thread.personEmail.toLowerCase())}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Right panel: thread detail ──────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {!selectedThread ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-[14px] text-zinc-400">Select a conversation</p>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
              <div className="min-w-0">
                <h2 className="truncate text-[15px] font-semibold text-zinc-900">
                  {selectedThread.subject}
                </h2>
                <p className="mt-0.5 text-[12px] text-zinc-400">
                  {selectedThread.personName ?? selectedThread.personEmail}
                  {selectedThread.sourceUserName && connectedUsers.length > 1 && (
                    <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                      via {selectedThread.sourceUserName}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {loadingMessages ? (
                <div className="flex justify-center py-8">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
                </div>
              ) : messages.length === 0 ? (
                <p className="text-center text-[13px] text-zinc-400">No messages</p>
              ) : (
                messages.map((msg) => (
                  <MessageBubble key={msg.id} msg={msg} myEmails={myEmails} />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply composer */}
            <div className="border-t border-zinc-100 bg-white">
              <div className="px-4 py-3">
                {/* From / To meta */}
                <div className="mb-2 flex items-center gap-4 text-[12px] text-zinc-400">
                  <span>
                    <span className="font-medium text-zinc-500">From:</span>{" "}
                    {selectedThread.sourceUserEmail ?? connectedUsers[0]?.email ?? ""}
                  </span>
                  <span>
                    <span className="font-medium text-zinc-500">To:</span>{" "}
                    {selectedThread.personEmail}
                  </span>
                </div>

                {/* Textarea with @ mention */}
                <div className="relative">
                  <textarea
                    ref={replyRef}
                    value={replyBody}
                    onChange={handleReplyChange}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void sendReply();
                      }
                      if (e.key === "Escape") setMentionQuery(null);
                    }}
                    placeholder={`Reply… (type @ to mention a teammate, ⌘↵ to send)`}
                    rows={4}
                    className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-[13px] text-zinc-800 placeholder:text-zinc-400 outline-none focus:border-zinc-300 focus:bg-white transition-colors"
                  />

                  {/* @ mention dropdown */}
                  {mentionQuery !== null && filteredMentionMembers.length > 0 && (
                    <div className="absolute bottom-full left-0 mb-1 w-64 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg z-10">
                      <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 border-b border-zinc-100">
                        Mention a teammate
                      </div>
                      {filteredMentionMembers.map((m) => (
                        <button
                          key={m.email}
                          onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-zinc-50 transition-colors"
                        >
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-600">
                            {getInitials(m.name)}
                          </div>
                          <div>
                            <p className="text-[12px] font-medium text-zinc-800">{m.name}</p>
                            <p className="text-[11px] text-zinc-400">{m.email}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Send bar */}
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-[11px] text-zinc-400">
                    Type <kbd className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-zinc-500">@</kbd> to mention a teammate
                  </p>
                  <button
                    onClick={sendReply}
                    disabled={!replyBody.trim() || sendingReply}
                    className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white transition-opacity disabled:opacity-40 hover:bg-zinc-700"
                  >
                    {sendingReply ? (
                      <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    ) : (
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                      </svg>
                    )}
                    Send
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
