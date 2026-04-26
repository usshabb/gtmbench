"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LetterAvatar, safeJson, apiFetch, FallbackImg } from "../components";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface ThreadComment {
  _id: string;
  threadId: string;
  authorEmail: string;
  authorName: string;
  body: string;
  mentions: string[];
  createdAt: string;
}

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
  | { type: "company"; domain: string; name: string }
  | { type: "source"; email: string; name: string };

interface EmailTemplate {
  _id: string;
  title: string;
  body: string;
}

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
  sourceUser,
  showSource,
}: {
  thread: InboxThread;
  selected: boolean;
  isRead: boolean;
  onClick: () => void;
  profilePic?: string;
  sourceUser?: { name: string; profilePhotoUrl?: string | null };
  showSource?: boolean;
}) {
  const { name: fromName } = parseDisplayName(thread.from);
  const displayName = thread.personName ?? fromName;
  const unread = thread.isUnread && !isRead;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors border-b border-[#ededf0] border-l-2 ${
        selected
          ? "bg-[#f5f5f7] border-l-[#8b8d94]"
          : unread
            ? "border-l-[#5e6ad2] hover:bg-[#f9f9fb]"
            : "border-l-transparent hover:bg-[#f9f9fb]"
      }`}
    >
      {/* Avatar */}
      <div className="shrink-0">
        <LetterAvatar name={displayName} size="sm" src={profilePic} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-[13px] ${unread ? "font-medium text-[#1b1b1f]" : "font-medium text-[#6b6f76]"}`}>
            {displayName}
          </span>
          <span className="shrink-0 text-[11px] text-[#8b8d94]">{formatDate(thread.date)}</span>
        </div>
        <p className={`truncate text-[12px] leading-snug ${unread ? "font-medium text-[#6b6f76]" : "text-[#6b6f76]"}`}>
          {thread.subject}
        </p>
        <p className="truncate text-[11px] leading-snug text-[#8b8d94]">{thread.snippet}</p>
        {showSource && sourceUser && (
          <div className="mt-1 flex items-center gap-1 group/source">
            <span className="text-[10px] text-[#8b8d94]">Synced from</span>
            <div className="relative">
              <FallbackImg src={sourceUser.profilePhotoUrl} className="h-3.5 w-3.5 rounded-full object-cover">
                <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#e6e6e9] text-[7px] font-semibold text-[#6b6f76]">
                  {sourceUser.name.charAt(0).toUpperCase()}
                </div>
              </FallbackImg>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/source:block">
                <div className="whitespace-nowrap rounded bg-[#1b1b1f] px-2 py-1 text-[10px] text-white">
                  {sourceUser.name.split(" ")[0]}
                </div>
              </div>
            </div>
          </div>
        )}
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
    <div className={`flex gap-2.5 ${isMine ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div className="shrink-0">
        <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold ${
          isMine ? "bg-[#1b1b1f] text-white" : "bg-[#e6e6e9] text-[#6b6f76]"
        }`}>
          {getInitials(fromName)}
        </div>
      </div>

      {/* Bubble */}
      <div className={`min-w-0 max-w-[90%] ${isMine ? "items-end" : "items-start"} flex flex-col`}>
        {/* Header */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className={`flex items-center gap-2 mb-1 ${isMine ? "flex-row-reverse" : ""} group`}
        >
          <span className="text-[12px] font-semibold text-[#6b6f76]">{fromName}</span>
          <span className="text-[11px] text-[#8b8d94]">{formatDate(msg.date)}</span>
          <svg className={`h-3 w-3 text-[#8b8d94] group-hover:text-[#6b6f76] transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {expanded && (
          <div className={`rounded-2xl px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap break-words ${
            isMine
              ? "bg-[#1b1b1f] text-white rounded-tr-sm"
              : "bg-[#f5f5f7] text-[#1b1b1f] rounded-tl-sm"
          }`}>
            {msg.body || <span className="italic opacity-50">No content</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Internal Comments ───────────────────────────────────────────────────────

function InternalComments({
  threadId,
  authToken,
  apiBaseUrl,
  connectedUsers,
  onCountChange,
}: {
  threadId: string;
  authToken: string;
  apiBaseUrl: string;
  connectedUsers: { email: string; name: string; profilePhotoUrl?: string | null }[];
  onCountChange?: (count: number) => void;
}) {
  const [comments, setComments] = useState<ThreadComment[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionAnchorPos, setMentionAnchorPos] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const loadedThreadRef = useRef<string | null>(null);

  // Fetch comments when thread changes
  useEffect(() => {
    if (!threadId || !authToken) return;
    if (loadedThreadRef.current === threadId) return;
    loadedThreadRef.current = threadId;

    void apiFetch(`${apiBaseUrl}/inbox/threads/${threadId}/comments`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(async (res) => {
        const data = (await safeJson(res)) as { comments?: ThreadComment[] };
        const list = data.comments ?? [];
        setComments(list);
        onCountChange?.(list.length);
      })
      .catch(() => setComments([]));
  }, [threadId, authToken, apiBaseUrl, onCountChange]);

  // Reset when thread changes
  useEffect(() => {
    loadedThreadRef.current = null;
    setComments([]);
    setBody("");
    setMentionQuery(null);
  }, [threadId]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setBody(val);

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
    const ta = inputRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart ?? body.length;
    const before = body.slice(0, mentionAnchorPos);
    const after = body.slice(cursor);
    const tag = `@${member.name} `;
    const next = before + tag + after;
    setBody(next);
    setMentionQuery(null);
    setTimeout(() => {
      ta.focus();
      const pos = before.length + tag.length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  }

  const filteredMembers = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return connectedUsers.filter(
      (m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    );
  }, [mentionQuery, connectedUsers]);

  // Extract @mentions from body
  function extractMentions(text: string): string[] {
    const mentions: string[] = [];
    const regex = /@(\S+(?:\s\S+)?)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const name = match[1];
      const user = connectedUsers.find(
        (u) => u.name.toLowerCase() === name.toLowerCase(),
      );
      if (user) mentions.push(user.email);
    }
    return mentions;
  }

  async function submitComment() {
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      const mentions = extractMentions(body);
      const res = await apiFetch(`${apiBaseUrl}/inbox/threads/${threadId}/comments`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ body: body.trim(), mentions }),
      });
      const data = (await safeJson(res)) as { comment?: ThreadComment };
      if (data.comment) {
        setComments((prev) => {
          const next = [...prev, data.comment!];
          onCountChange?.(next.length);
          return next;
        });
      }
      setBody("");
      setMentionQuery(null);
    } catch { /* ignore */ } finally {
      setSending(false);
    }
  }

  // Render body with @mentions highlighted
  function renderCommentBody(text: string) {
    const parts = text.split(/(@\S+(?:\s\S+)?)/g);
    return parts.map((part, i) => {
      if (part.startsWith("@")) {
        const name = part.slice(1);
        const isUser = connectedUsers.some(
          (u) => u.name.toLowerCase() === name.toLowerCase(),
        );
        if (isUser) {
          return (
            <span key={i} className="rounded bg-[#5e6ad2]/10 px-1 py-0.5 text-[#5e6ad2] font-medium">
              {part}
            </span>
          );
        }
      }
      return part;
    });
  }

  return (
    <div className="flex flex-1 flex-col bg-[#f9f9fb]">
      {/* Existing comments */}
      {comments.length > 0 && (
        <div className="flex-1 px-4 pt-3 pb-1 space-y-2.5 overflow-y-auto">
          {comments.map((c) => (
            <div key={c._id} className="flex gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#ededf0] text-[9px] font-semibold text-[#6b6f76]">
                {getInitials(c.authorName)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12px] font-semibold text-[#1b1b1f]">{c.authorName}</span>
                  <span className="text-[10px] text-[#8b8d94]">{formatDate(c.createdAt)}</span>
                </div>
                <p className="text-[12px] text-[#6b6f76] leading-relaxed whitespace-pre-wrap break-words">
                  {renderCommentBody(c.body)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Comment input */}
      <div className="px-4 py-2.5">
        <div className="relative flex items-start gap-2 rounded-lg border border-[#e6e6e9] bg-white px-3 py-2 focus-within:border-[#8b8d94] transition-colors">
          <textarea
            ref={inputRef}
            value={body}
            onChange={handleChange}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submitComment();
              }
              if (e.key === "Escape") setMentionQuery(null);
            }}
            placeholder="Add internal comment · visible to your team"
            rows={1}
            className="flex-1 resize-none bg-transparent text-[12px] text-[#1b1b1f] placeholder:text-[#8b8d94] outline-none min-h-[20px]"
          />
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (inputRef.current) {
                  const pos = inputRef.current.selectionStart ?? body.length;
                  const before = body.slice(0, pos);
                  const after = body.slice(pos);
                  setBody(before + "@" + after);
                  setMentionQuery("");
                  setMentionAnchorPos(pos);
                  setTimeout(() => {
                    inputRef.current?.focus();
                    const newPos = pos + 1;
                    inputRef.current?.setSelectionRange(newPos, newPos);
                  }, 0);
                }
              }}
              className="rounded p-1 text-[#8b8d94] hover:bg-[#f5f5f7] hover:text-[#6b6f76] transition-colors"
              title="Mention teammate"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>
              </svg>
            </button>
            <button
              onClick={submitComment}
              disabled={!body.trim() || sending}
              className="rounded p-1 text-[#8b8d94] hover:bg-[#f5f5f7] hover:text-[#1b1b1f] transition-colors disabled:opacity-30"
              title="Post comment"
            >
              {sending ? (
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#8b8d94]/30 border-t-[#8b8d94]" />
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" x2="11" y1="2" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              )}
            </button>
          </div>

          {/* @ mention dropdown */}
          {mentionQuery !== null && filteredMembers.length > 0 && (
            <div className="absolute bottom-full left-0 mb-1 w-60 overflow-hidden rounded-lg border border-[#e6e6e9] bg-white shadow-md z-10">
              {filteredMembers.map((m) => (
                <button
                  key={m.email}
                  onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#f9f9fb] transition-colors"
                >
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#e6e6e9] text-[9px] font-semibold text-[#6b6f76]">
                    {getInitials(m.name)}
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-[#1b1b1f]">{m.name}</p>
                    <p className="text-[10px] text-[#8b8d94]">{m.email}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
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
  const [connectedUsers, setConnectedUsers] = useState<{ email: string; name: string; profilePhotoUrl?: string | null }[]>([]);
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
  const [filterPanel, setFilterPanel] = useState<"main" | "people" | "company" | "source">("main");
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

  // Template picker
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [emailSignature, setEmailSignature] = useState("");
  const templatesFetched = useRef(false);
  const [bottomTab, setBottomTab] = useState<"reply" | "comments">("reply");
  const [commentCount, setCommentCount] = useState(0);

  const fetchTemplates = useCallback(async () => {
    if (!authToken || templatesFetched.current) return;
    templatesFetched.current = true;
    try {
      const [tRes, sRes] = await Promise.all([
        apiFetch(`${apiBaseUrl}/email-templates`, { headers: { Authorization: `Bearer ${authToken}` } }),
        apiFetch(`${apiBaseUrl}/email-signature`, { headers: { Authorization: `Bearer ${authToken}` } }),
      ]);
      const tData = (await tRes.json()) as { templates: EmailTemplate[] };
      setEmailTemplates(tData.templates ?? []);
      const sData = (await sRes.json()) as { signature: string };
      setEmailSignature(sData.signature ?? "");
    } catch { /* ignore */ }
  }, [apiBaseUrl, authToken]);

  function resolveTemplateForReply(tmpl: EmailTemplate) {
    if (!selectedThread) return;
    const firstName = selectedThread.personName?.split(" ")[0] ?? "";
    const fullName = selectedThread.personName ?? "";
    const email = selectedThread.personEmail ?? "";
    const domain = selectedThread.personEmail?.split("@")[1] ?? "";
    const resolved = tmpl.body
      .replace(/\{\{first_name\}\}/g, firstName)
      .replace(/\{\{full_name\}\}/g, fullName)
      .replace(/\{\{email\}\}/g, email)
      .replace(/\{\{website\}\}/g, domain)
      .replace(/\{\{ats_name\}\}/g, "");
    setReplyBody(resolved);
    setShowTemplatePicker(false);
  }

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
        connectedUsers?: { email: string; name: string; profilePhotoUrl?: string | null }[];
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
    setBottomTab("reply");
    setCommentCount(0);

    // Fetch comment count
    void apiFetch(`${apiBaseUrl}/inbox/threads/${thread.id}/comments`, {
      headers: { Authorization: `Bearer ${authToken}` },
    }).then(async (res) => {
      const data = (await safeJson(res)) as { comments?: unknown[] };
      setCommentCount((data.comments ?? []).length);
    }).catch(() => {});

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
          body: emailSignature ? `${replyBody}\n\n${emailSignature}` : replyBody,
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

  const sourceUserMap = useMemo(() => {
    const map = new Map<string, { name: string; profilePhotoUrl?: string | null }>();
    for (const u of connectedUsers) map.set(u.email, { name: u.name, profilePhotoUrl: u.profilePhotoUrl });
    return map;
  }, [connectedUsers]);

  const showSourceIndicators = connectedUsers.length >= 1;

  // Helper: is a filter active?
  function isFilterActive(item: FilterItem) {
    return activeFilters.some((f) =>
      f.type === item.type &&
      (f.type === "person" && item.type === "person" ? f.email === item.email :
       f.type === "company" && item.type === "company" ? f.domain === item.domain :
       f.type === "source" && item.type === "source" ? f.email === item.email : false),
    );
  }

  function toggleFilter(item: FilterItem) {
    setActiveFilters((prev) => {
      const active = prev.some((f) =>
        f.type === item.type &&
        (f.type === "person" && item.type === "person" ? f.email === item.email :
         f.type === "company" && item.type === "company" ? f.domain === item.domain :
         f.type === "source" && item.type === "source" ? f.email === item.email : false),
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
      const sourceFilters = activeFilters.filter((f): f is Extract<FilterItem, { type: "source" }> => f.type === "source");

      result = result.filter((t) => {
        const personMeta = personEmails.find((p) => p.email.toLowerCase() === t.personEmail.toLowerCase());
        const matchesPerson = personFilters.length === 0 || personFilters.some((f) => f.email.toLowerCase() === t.personEmail.toLowerCase());
        const matchesCompany = companyFilters.length === 0 || companyFilters.some((f) => personMeta?.companyDomain === f.domain);
        const matchesSource = sourceFilters.length === 0 || sourceFilters.some((f) => f.email.toLowerCase() === (t.sourceUserEmail ?? "").toLowerCase());
        return matchesPerson && matchesCompany && matchesSource;
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
      <div className="flex w-[340px] shrink-0 flex-col border-r border-[#e6e6e9] overflow-hidden">

        {/* Search + Filter button */}
        <div className="border-b border-[#ededf0] px-3 py-3">
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-lg bg-[#f5f5f7] px-3 py-2">
              <svg className="h-3.5 w-3.5 shrink-0 text-[#8b8d94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-[#1b1b1f] placeholder:text-[#8b8d94] outline-none"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="text-[#8b8d94] hover:text-[#6b6f76]">
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
                    ? "bg-[#1b1b1f] text-white"
                    : "bg-[#f5f5f7] text-[#6b6f76] hover:bg-[#e6e6e9]"
                }`}
              >
                {activeFilters.length > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#5e6ad2] px-1 text-[9px] font-semibold text-white">
                    {activeFilters.length}
                  </span>
                )}
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
              </button>

              {/* Dropdown */}
              {showFilter && (
                <div className="absolute right-0 top-full mt-1 w-64 overflow-hidden rounded-lg border border-[#e6e6e9] bg-white z-30">

                  {/* Main panel */}
                  {filterPanel === "main" && (
                    <div>
                      <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#8b8d94] border-b border-[#ededf0]">
                        Filter by
                      </div>
                      <button
                        onClick={() => { setFilterPanel("people"); setPanelSearch(""); }}
                        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[#f9f9fb] transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          <svg className="h-4 w-4 text-[#8b8d94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                          </svg>
                          <span className="text-[13px] font-medium text-[#6b6f76]">People</span>
                          {activeFilters.filter((f) => f.type === "person").length > 0 && (
                            <span className="rounded-full bg-[#1b1b1f] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              {activeFilters.filter((f) => f.type === "person").length}
                            </span>
                          )}
                        </div>
                        <svg className="h-3.5 w-3.5 text-[#8b8d94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                      </button>
                      <button
                        onClick={() => { setFilterPanel("company"); setPanelSearch(""); }}
                        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[#f9f9fb] transition-colors border-t border-[#ededf0]"
                      >
                        <div className="flex items-center gap-2.5">
                          <svg className="h-4 w-4 text-[#8b8d94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
                          </svg>
                          <span className="text-[13px] font-medium text-[#6b6f76]">Company</span>
                          {activeFilters.filter((f) => f.type === "company").length > 0 && (
                            <span className="rounded-full bg-[#1b1b1f] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              {activeFilters.filter((f) => f.type === "company").length}
                            </span>
                          )}
                        </div>
                        <svg className="h-3.5 w-3.5 text-[#8b8d94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                      </button>
                      {connectedUsers.length > 1 && (
                        <button
                          onClick={() => { setFilterPanel("source" as "main"); setPanelSearch(""); }}
                          className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[#f9f9fb] transition-colors border-t border-[#ededf0]"
                        >
                          <div className="flex items-center gap-2.5">
                            <svg className="h-4 w-4 text-[#8b8d94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                            </svg>
                            <span className="text-[13px] font-medium text-[#6b6f76]">Synced from</span>
                            {activeFilters.filter((f) => f.type === "source").length > 0 && (
                              <span className="rounded-full bg-[#1b1b1f] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                {activeFilters.filter((f) => f.type === "source").length}
                              </span>
                            )}
                          </div>
                          <svg className="h-3.5 w-3.5 text-[#8b8d94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                          </svg>
                        </button>
                      )}
                      {activeFilters.length > 0 && (
                        <button
                          onClick={() => { setActiveFilters([]); setShowFilter(false); }}
                          className="flex w-full items-center justify-center px-4 py-2.5 text-[12px] font-medium text-red-500 hover:bg-red-50 border-t border-[#ededf0] transition-colors"
                        >
                          Clear all filters
                        </button>
                      )}
                    </div>
                  )}

                  {/* People sub-panel */}
                  {filterPanel === "people" && (
                    <div>
                      <div className="flex items-center gap-2 border-b border-[#ededf0] px-3 py-2">
                        <button
                          onClick={() => setFilterPanel("main")}
                          className="text-[#8b8d94] hover:text-[#6b6f76]"
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
                          className="flex-1 text-[12px] text-[#1b1b1f] placeholder:text-[#8b8d94] outline-none"
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
                                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[#f9f9fb] transition-colors"
                              >
                                <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${active ? "border-[#1b1b1f] bg-[#1b1b1f]" : "border-[#8b8d94]"}`}>
                                  {active && (
                                    <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                    </svg>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-[12px] font-medium text-[#1b1b1f]">{p.name}</p>
                                  <p className="truncate text-[11px] text-[#8b8d94]">{p.email}</p>
                                </div>
                              </button>
                            );
                          })}
                        {personEmails.filter((p) => !panelSearch || p.name.toLowerCase().includes(panelSearch.toLowerCase())).length === 0 && (
                          <p className="px-4 py-4 text-[12px] text-[#8b8d94]">No people found</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Company sub-panel */}
                  {filterPanel === "company" && (
                    <div>
                      <div className="flex items-center gap-2 border-b border-[#ededf0] px-3 py-2">
                        <button
                          onClick={() => setFilterPanel("main")}
                          className="text-[#8b8d94] hover:text-[#6b6f76]"
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
                          className="flex-1 text-[12px] text-[#1b1b1f] placeholder:text-[#8b8d94] outline-none"
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
                                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[#f9f9fb] transition-colors"
                              >
                                <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${active ? "border-[#1b1b1f] bg-[#1b1b1f]" : "border-[#8b8d94]"}`}>
                                  {active && (
                                    <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                    </svg>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-[12px] font-medium text-[#1b1b1f]">{c.name}</p>
                                  <p className="truncate text-[11px] text-[#8b8d94]">{c.domain}</p>
                                </div>
                              </button>
                            );
                          })}
                        {companies.filter((c) => !panelSearch || c.name.toLowerCase().includes(panelSearch.toLowerCase())).length === 0 && (
                          <p className="px-4 py-4 text-[12px] text-[#8b8d94]">No companies found</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Source user sub-panel */}
                  {filterPanel === "source" && (
                    <div>
                      <div className="flex items-center gap-2 border-b border-[#ededf0] px-3 py-2">
                        <button
                          onClick={() => setFilterPanel("main")}
                          className="text-[#8b8d94] hover:text-[#6b6f76]"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                          </svg>
                        </button>
                        <span className="text-[12px] font-medium text-[#6b6f76]">Synced from</span>
                      </div>
                      <div className="max-h-56 overflow-y-auto">
                        {connectedUsers.map((u) => {
                          const item: FilterItem = { type: "source", email: u.email, name: u.name };
                          const active = isFilterActive(item);
                          return (
                            <button
                              key={u.email}
                              onClick={() => toggleFilter(item)}
                              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[#f9f9fb] transition-colors"
                            >
                              <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${active ? "border-[#1b1b1f] bg-[#1b1b1f]" : "border-[#8b8d94]"}`}>
                                {active && (
                                  <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                  </svg>
                                )}
                              </div>
                              <div className="flex items-center gap-2 min-w-0">
                                <FallbackImg src={u.profilePhotoUrl} className="h-5 w-5 rounded-full object-cover">
                                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#e6e6e9] text-[9px] font-semibold text-[#6b6f76]">
                                    {u.name.charAt(0).toUpperCase()}
                                  </div>
                                </FallbackImg>
                                <div className="min-w-0">
                                  <p className="truncate text-[12px] font-medium text-[#1b1b1f]">{u.name}</p>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* All / Unread toggle */}
        <div className="flex items-center px-3 py-2 border-b border-[#ededf0]">
          <div className="inline-flex rounded-lg bg-[#f5f5f7] p-0.5">
            <button
              onClick={() => setTabFilter("all")}
              className={`rounded-md px-3 py-1 text-[12px] font-medium transition-colors ${
                tabFilter === "all"
                  ? "bg-white text-[#1b1b1f]"
                  : "text-[#6b6f76] hover:text-[#6b6f76]"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setTabFilter("unread")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[12px] font-medium transition-colors ${
                tabFilter === "unread"
                  ? "bg-white text-[#1b1b1f]"
                  : "text-[#6b6f76] hover:text-[#6b6f76]"
              }`}
            >
              Unread
              {unreadCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#5e6ad2] px-1 text-[10px] font-semibold text-white">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Active filter pills */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap gap-1 px-3 py-1.5 border-b border-[#ededf0]">
            {activeFilters.map((f, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full bg-[#1b1b1f] pl-2.5 pr-1.5 py-0.5 text-[11px] font-medium text-white"
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
              <p className="text-[13px] text-[#8b8d94]">No emails found</p>
            </div>
          ) : (
            filtered.map((thread) => (
              <ThreadRow
                key={thread.id + (thread.sourceUserEmail ?? "")}
                thread={thread}
                selected={selectedThread?.id === thread.id}
                isRead={readIds.has(thread.id)}
                onClick={() => selectThread(thread)}
                profilePic={profilePicMap.get(thread.personEmail.toLowerCase())}
                sourceUser={thread.sourceUserEmail ? sourceUserMap.get(thread.sourceUserEmail) : undefined}
                showSource={showSourceIndicators}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Right panel: thread detail ──────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {!selectedThread ? (
          <div className="flex h-full flex-col items-center justify-center gap-1">
            <svg className="h-8 w-8 text-[#8b8d94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
            <p className="text-[13px] text-[#8b8d94]">Select a conversation</p>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="flex items-center justify-between border-b border-[#e6e6e9] px-5 py-3">
              <div className="min-w-0">
                <h2 className="truncate text-[14px] font-semibold text-[#1b1b1f]">
                  {selectedThread.subject}
                </h2>
                <p className="mt-0.5 text-[12px] text-[#6b6f76]">
                  {selectedThread.personName ?? selectedThread.personEmail}
                  {selectedThread.sourceUserName && connectedUsers.length >= 1 && (
                    <span className="ml-1.5 text-[11px] text-[#8b8d94]">
                      via {selectedThread.sourceUserName}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Messages — capped height so bottom panel has room */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 space-y-3" style={{ maxHeight: "calc(100vh - 320px)" }}>
              {loadingMessages ? (
                <div className="flex justify-center py-8">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
                </div>
              ) : messages.length === 0 ? (
                <p className="text-center text-[13px] text-[#8b8d94]">No messages</p>
              ) : (
                messages.map((msg) => (
                  <MessageBubble key={msg.id} msg={msg} myEmails={myEmails} />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Bottom panel — tabbed: Reply / Comments */}
            <div className="border-t border-[#e6e6e9] flex flex-col min-h-[180px]">
              {/* Tabs */}
              <div className="flex items-center gap-0 px-4 border-b border-[#ededf0]">
                <button
                  onClick={() => setBottomTab("reply")}
                  className={`px-3 py-2 text-[12px] font-medium border-b-2 transition-colors ${
                    bottomTab === "reply"
                      ? "border-[#1b1b1f] text-[#1b1b1f]"
                      : "border-transparent text-[#8b8d94] hover:text-[#6b6f76]"
                  }`}
                >
                  Reply
                </button>
                <button
                  onClick={() => setBottomTab("comments")}
                  className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium border-b-2 transition-colors ${
                    bottomTab === "comments"
                      ? "border-[#1b1b1f] text-[#1b1b1f]"
                      : "border-transparent text-[#8b8d94] hover:text-[#6b6f76]"
                  }`}
                >
                  Comments
                  {commentCount > 0 && (
                    <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#5e6ad2] px-1 text-[10px] font-semibold text-white leading-none">
                      {commentCount}
                    </span>
                  )}
                </button>
              </div>

              {/* Tab content */}
              <div className="flex-1 flex flex-col">
                {bottomTab === "reply" ? (
                  <div className="flex-1 flex flex-col px-4 py-3">
                    <div className="relative flex-1 flex flex-col rounded-lg border border-[#e6e6e9] bg-[#f9f9fb] focus-within:border-[#8b8d94] focus-within:bg-white transition-colors">
                      <textarea
                        ref={replyRef}
                        value={replyBody}
                        onChange={(e) => {
                          handleReplyChange(e);
                          // Auto-grow
                          e.target.style.height = "auto";
                          e.target.style.height = Math.max(60, e.target.scrollHeight) + "px";
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            void sendReply();
                          }
                          if (e.key === "Escape") setMentionQuery(null);
                        }}
                        placeholder="Write a reply…"
                        className="flex-1 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-[13px] text-[#1b1b1f] placeholder:text-[#8b8d94] outline-none"
                        style={{ minHeight: 60 }}
                      />

                      {/* Actions bar inside the box */}
                      <div className="flex items-center justify-between px-2 pb-2 shrink-0">
                        <div className="relative">
                          <button
                            onClick={() => { void fetchTemplates(); setShowTemplatePicker((p) => !p); }}
                            className="rounded-md px-2 py-1 text-[11px] font-medium text-[#8b8d94] hover:bg-black/[0.04] hover:text-[#6b6f76] transition-colors"
                          >
                            Use template
                          </button>
                          {showTemplatePicker && (
                            <div className="absolute left-0 bottom-full mb-1 w-64 rounded-lg border border-[#e6e6e9] bg-white shadow-lg z-20 overflow-hidden">
                              {emailTemplates.length === 0 ? (
                                <p className="px-3 py-3 text-[12px] text-[#8b8d94]">No templates yet</p>
                              ) : (
                                emailTemplates.map((t) => (
                                  <button
                                    key={t._id}
                                    onClick={() => resolveTemplateForReply(t)}
                                    className="flex w-full flex-col px-3 py-2 text-left hover:bg-[#f9f9fb] transition-colors"
                                  >
                                    <span className="text-[12px] font-medium text-[#1b1b1f]">{t.title}</span>
                                    <span className="text-[11px] text-[#8b8d94] line-clamp-1 font-mono">{t.body}</span>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2.5">
                          <span className="text-[10px] text-[#8b8d94]">
                            <kbd className="rounded bg-black/[0.04] px-1 py-0.5 font-mono text-[9px] text-[#8b8d94]">⌘↵</kbd>
                          </span>
                          <button
                            onClick={sendReply}
                            disabled={!replyBody.trim() || sendingReply}
                            className="flex items-center gap-1.5 rounded-md bg-[#1b1b1f] px-3 py-1 text-[11px] font-medium text-white transition-opacity disabled:opacity-30 hover:bg-[#2c2c33]"
                          >
                            {sendingReply ? (
                              <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                            ) : (
                              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                              </svg>
                            )}
                            Send
                          </button>
                        </div>
                      </div>

                      {/* @ mention dropdown */}
                      {mentionQuery !== null && filteredMentionMembers.length > 0 && (
                        <div className="absolute bottom-full left-0 mb-1 w-60 overflow-hidden rounded-lg border border-[#e6e6e9] bg-white shadow-md z-10">
                          {filteredMentionMembers.map((m) => (
                            <button
                              key={m.email}
                              onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#f9f9fb] transition-colors"
                            >
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e6e6e9] text-[10px] font-semibold text-[#6b6f76]">
                                {getInitials(m.name)}
                              </div>
                              <div>
                                <p className="text-[12px] font-medium text-[#1b1b1f]">{m.name}</p>
                                <p className="text-[11px] text-[#8b8d94]">{m.email}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col">
                    <InternalComments
                      threadId={selectedThread.id}
                      authToken={authToken}
                      apiBaseUrl={apiBaseUrl}
                      connectedUsers={connectedUsers}
                      onCountChange={setCommentCount}
                    />
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
