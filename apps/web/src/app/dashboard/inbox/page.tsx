"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LetterAvatar, safeJson, apiFetch, FallbackImg, COMPOSE_EMAIL_EVENT } from "../components";

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
  const isThisYear = d.getFullYear() === now.getFullYear();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (isThisYear) return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}, ${time}`;
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

interface TrackingInfo {
  openCount: number;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
}

function MessageBubble({
  msg,
  myEmails,
  isLast,
  tracking,
}: {
  msg: ThreadMessage;
  myEmails: string[];
  isLast: boolean;
  tracking?: TrackingInfo | null;
}) {
  const { name: fromName, address: fromAddress } = parseDisplayName(msg.from);
  const isMine = myEmails.some((e) => fromAddress.toLowerCase().includes(e.toLowerCase()));
  const [expanded, setExpanded] = useState(isLast);

  // Collapsed row — single-line summary like Gmail
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[#f5f5f7] transition-colors group"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e6e6e9] text-[10px] font-semibold text-[#6b6f76]">
          {getInitials(fromName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-semibold text-[#1b1b1f] truncate">{fromName}</span>
            <span className="text-[12px] text-[#8b8d94] whitespace-nowrap shrink-0">{formatDate(msg.date)}</span>
          </div>
          <p className="text-[12px] text-[#8b8d94] truncate mt-0.5">
            {msg.body || "(No content)"}
          </p>
        </div>
      </button>
    );
  }

  // Expanded view — full message body
  return (
    <div className="rounded-lg">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-3 py-2.5">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e6e6e9] text-[10px] font-semibold text-[#6b6f76] mt-0.5">
            {getInitials(fromName)}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[#1b1b1f]">{fromName}</p>
            {msg.to && (
              <button
                onClick={() => setExpanded(false)}
                className="flex items-center gap-1 text-[11px] text-[#8b8d94] hover:text-[#6b6f76] transition-colors"
              >
                <span>To: {parseDisplayName(msg.to).name}</span>
                <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 pt-0.5">
          {isMine && tracking && tracking.openCount > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600" title={`Opened ${tracking.openCount} time${tracking.openCount > 1 ? "s" : ""}${tracking.lastOpenedAt ? ` · Last: ${formatDate(tracking.lastOpenedAt)}` : ""}`}>
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              Opened{tracking.openCount > 1 ? ` ${tracking.openCount}x` : ""}
            </span>
          )}
          {isMine && tracking && tracking.openCount === 0 && (
            <span className="flex items-center gap-1 text-[10px] text-[#8b8d94]" title="Not opened yet">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
              Sent
            </span>
          )}
          <span className="text-[12px] text-[#8b8d94] whitespace-nowrap">{formatDate(msg.date)}</span>
        </div>
      </div>

      {/* Body */}
      <div className="px-3 pb-4 pl-14">
        <div className="text-[13px] leading-relaxed text-[#1b1b1f] whitespace-pre-wrap break-words">
          {msg.body || <span className="italic text-[#8b8d94]">No content</span>}
        </div>
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
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#f0f0f2]">
        <div className="flex items-center gap-2 text-[12px] text-[#8b8d94]">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
          </svg>
          <span className="font-medium text-[#6b6f76]">Internal comments</span>
          <span className="text-[11px]">· visible to your team only</span>
        </div>
      </div>

      {/* Existing comments */}
      {comments.length > 0 && (
        <div className="px-4 pt-3 pb-1 space-y-3">
          {comments.map((c) => (
            <div key={c._id} className="flex gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#e6e6e9] text-[10px] font-semibold text-[#6b6f76]">
                {getInitials(c.authorName)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12px] font-semibold text-[#1b1b1f]">{c.authorName}</span>
                  <span className="text-[11px] text-[#8b8d94]">{formatDate(c.createdAt)}</span>
                </div>
                <p className="text-[12px] text-[#6b6f76] leading-relaxed whitespace-pre-wrap break-words mt-0.5">
                  {renderCommentBody(c.body)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Comment input */}
      <div className="relative">
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
          placeholder="Write a comment…"
          className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-[13px] text-[#1b1b1f] placeholder:text-[#8b8d94] outline-none"
          style={{ minHeight: 80 }}
        />

        {/* Footer actions */}
        <div className="flex items-center justify-between px-3 py-2.5 border-t border-[#f0f0f2]">
          <div className="flex items-center gap-1">
            <button
              onClick={submitComment}
              disabled={!body.trim() || sending}
              className="flex items-center gap-1.5 rounded-lg bg-[#4338ca] px-3.5 py-1.5 text-[12px] font-medium text-white transition-opacity disabled:opacity-30 hover:bg-[#3730a3]"
            >
              {sending ? (
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : null}
              Comment
            </button>
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
              className="flex items-center gap-1 rounded-lg border border-[#e6e6e9] px-2.5 py-1.5 text-[12px] font-medium text-[#6b6f76] hover:bg-[#f5f5f7] transition-colors"
              title="Mention teammate"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>
              </svg>
              Mention
            </button>
          </div>
          <div className="flex items-center gap-3 text-[#8b8d94]">
            <kbd className="rounded bg-black/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-[#8b8d94]">⌘↵</kbd>
          </div>
        </div>

        {/* @ mention dropdown */}
        {mentionQuery !== null && filteredMembers.length > 0 && (
          <div className="absolute left-4 bottom-16 w-60 overflow-hidden rounded-lg border border-[#e6e6e9] bg-white shadow-md z-10">
            {filteredMembers.map((m) => (
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
  const [refreshing, setRefreshing] = useState(false);
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
  const autoSelectRef = useRef<InboxThread | null>(null);

  // Thread detail
  const [selectedThread, setSelectedThread] = useState<InboxThread | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [trackingData, setTrackingData] = useState<{ recipientEmail: string; sentAt: string; openCount: number; firstOpenedAt: string | null; lastOpenedAt: string | null }[]>([]);

  // Reply
  const [activePanel, setActivePanel] = useState<"reply" | "comments" | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [draftingAI, setDraftingAI] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionAnchorPos, setMentionAnchorPos] = useState(0);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Template picker
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [emailSignature, setEmailSignature] = useState("");
  const templatesFetched = useRef(false);
  const [commentCount, setCommentCount] = useState(0);

  // Compose new email
  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState<PersonMeta | null>(null);
  const [composeToQuery, setComposeToQuery] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeSending, setComposeSending] = useState(false);
  const [showComposeTemplatePicker, setShowComposeTemplatePicker] = useState(false);
  const composeBodyRef = useRef<HTMLTextAreaElement>(null);
  const composeToRef = useRef<HTMLInputElement>(null);

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

  function htmlToPlainText(html: string): string {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.innerText ?? tmp.textContent ?? "";
  }

  function resolveTemplateForReply(tmpl: EmailTemplate) {
    if (!selectedThread) return;
    const firstName = selectedThread.personName?.split(" ")[0] ?? "";
    const fullName = selectedThread.personName ?? "";
    const email = selectedThread.personEmail ?? "";
    const domain = selectedThread.personEmail?.split("@")[1] ?? "";
    const plainBody = htmlToPlainText(tmpl.body);
    const resolved = plainBody
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
      const loadedThreads = data.threads ?? [];
      setThreads(loadedThreads);
      setPersonEmails(data.personEmails ?? []);
      setConnectedUsers(data.connectedUsers ?? []);
      // Auto-select first thread
      if (loadedThreads.length > 0) {
        autoSelectRef.current = loadedThreads[0];
      }
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

  // Open compose via sidebar pencil shortcut
  useEffect(() => {
    const handler = () => openCompose();
    window.addEventListener(COMPOSE_EMAIL_EVENT, handler);
    return () => window.removeEventListener(COMPOSE_EMAIL_EVENT, handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-select first thread after load
  useEffect(() => {
    if (autoSelectRef.current && !selectedThread && threads.length > 0) {
      const thread = autoSelectRef.current;
      autoSelectRef.current = null;
      selectThread(thread);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads]);

  // ── Thread selection ──────────────────────────────────────────────────────

  async function selectThread(thread: InboxThread) {
    setSelectedThread(thread);
    setMessages([]);
    setReplyBody("");
    setMentionQuery(null);
    setLoadingMessages(true);
    setReadIds((prev) => new Set([...prev, thread.id]));
    setActivePanel(null);
    setCommentCount(0);
    setTrackingData([]);

    // Fetch tracking data
    void apiFetch(`${apiBaseUrl}/inbox/threads/${thread.id}/tracking`, {
      headers: { Authorization: `Bearer ${authToken}` },
    }).then(async (res) => {
      const data = (await safeJson(res)) as { tracks?: typeof trackingData };
      setTrackingData(data.tracks ?? []);
    }).catch(() => {});

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
      // Deduplicate messages — by id first, then by content+sender fingerprint
      const seen = new Set<string>();
      const deduped = (data.messages ?? []).filter((m) => {
        const fingerprint = `${m.id}||${m.from}::${m.date}::${m.body?.slice(0, 100)}`;
        if (seen.has(m.id) || seen.has(fingerprint)) return false;
        seen.add(m.id);
        seen.add(fingerprint);
        return true;
      });
      setMessages(deduped);
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

  async function generateAIDraft() {
    if (!selectedThread || messages.length === 0 || draftingAI) return;
    setActivePanel("reply");
    setDraftingAI(true);
    setReplyBody("");
    setTimeout(() => replyRef.current?.focus(), 50);
    try {
      const res = await apiFetch(`${apiBaseUrl}/inbox/threads/${selectedThread.id}/ai-draft`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messages.map((m) => ({ from: m.from, body: m.body, date: m.date })),
        }),
      });
      const data = (await res.json()) as { draft?: string; error?: string };
      if (data.draft) setReplyBody(data.draft);
    } catch { /* ignore */ }
    finally { setDraftingAI(false); }
  }

  // ── Compose ───────────────────────────────────────────────────────────────

  function openCompose() {
    setShowCompose(true);
    setComposeTo(null);
    setComposeToQuery("");
    setComposeSubject("");
    setComposeBody("");
    setShowComposeTemplatePicker(false);
    void fetchTemplates();
    setTimeout(() => composeToRef.current?.focus(), 100);
  }

  function closeCompose() {
    setShowCompose(false);
    setComposeTo(null);
    setComposeToQuery("");
    setComposeSubject("");
    setComposeBody("");
    setShowComposeTemplatePicker(false);
  }

  function resolveTemplateForCompose(tmpl: EmailTemplate) {
    const firstName = composeTo?.name?.split(" ")[0] ?? "";
    const fullName = composeTo?.name ?? "";
    const email = composeTo?.email ?? "";
    const domain = composeTo?.email?.split("@")[1] ?? "";
    const plainBody = htmlToPlainText(tmpl.body);
    const resolved = plainBody
      .replace(/\{\{first_name\}\}/g, firstName)
      .replace(/\{\{full_name\}\}/g, fullName)
      .replace(/\{\{email\}\}/g, email)
      .replace(/\{\{website\}\}/g, domain)
      .replace(/\{\{ats_name\}\}/g, "");
    setComposeBody(resolved);
    setShowComposeTemplatePicker(false);
  }

  const filteredPersonSuggestions = useMemo(() => {
    if (!composeToQuery || composeTo) return [];
    const q = composeToQuery.toLowerCase();
    return personEmails.filter(
      (p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q),
    ).slice(0, 8);
  }, [composeToQuery, composeTo, personEmails]);

  async function sendCompose() {
    if (!composeTo || !composeSubject.trim() || !composeBody.trim() || composeSending) return;
    setComposeSending(true);
    try {
      await apiFetch(`${apiBaseUrl}/inbox/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: composeTo.email,
          subject: composeSubject.trim(),
          body: composeBody,
        }),
      });
      closeCompose();
      // Refresh inbox to show the new thread
      void fetchInbox(authToken);
    } catch {
      // ignore
    } finally {
      setComposeSending(false);
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

        {/* All / Unread toggle + Compose + Refresh */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#ededf0]">
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
          <div className="flex items-center gap-0.5">
            <button
              onClick={openCompose}
              className="flex items-center justify-center rounded-md p-1.5 text-[#8b8d94] transition-colors hover:bg-[#f5f5f7] hover:text-[#6b6f76]"
              title="Compose email"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>
              </svg>
            </button>
            <button
              onClick={async () => {
                if (!authToken || refreshing) return;
                setRefreshing(true);
                await fetchInbox(authToken).finally(() => setRefreshing(false));
              }}
              disabled={refreshing}
              className="flex items-center justify-center rounded-md p-1.5 text-[#8b8d94] transition-colors hover:bg-[#f5f5f7] hover:text-[#6b6f76] disabled:opacity-50"
              title="Refresh inbox"
            >
              {refreshing ? (
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#e6e6e9] border-t-[#6b6f76]" />
              ) : (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                </svg>
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

      {/* ── Compose modal ────────────────────────────────────────────── */}
      {showCompose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={(e) => { if (e.target === e.currentTarget) closeCompose(); }}>
          <div className="w-full max-w-[560px] rounded-xl border border-[#e6e6e9] bg-white shadow-xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#ededf0] px-4 py-3">
              <h3 className="text-[14px] font-semibold text-[#1b1b1f]">New message</h3>
              <button onClick={closeCompose} className="rounded-md p-1 text-[#8b8d94] hover:bg-[#f5f5f7] hover:text-[#6b6f76] transition-colors">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* To field */}
            <div className="relative border-b border-[#f0f0f2] px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-[#8b8d94] shrink-0">To</span>
                {composeTo ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-[#f5f5f7] px-2 py-1 text-[12px] font-medium text-[#1b1b1f]">
                    {composeTo.name}
                    <span className="text-[11px] text-[#8b8d94]">&lt;{composeTo.email}&gt;</span>
                    <button
                      onClick={() => { setComposeTo(null); setComposeToQuery(""); setTimeout(() => composeToRef.current?.focus(), 0); }}
                      className="ml-0.5 rounded-full p-0.5 text-[#8b8d94] hover:text-[#6b6f76] hover:bg-[#e6e6e9] transition-colors"
                    >
                      <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ) : (
                  <input
                    ref={composeToRef}
                    type="text"
                    value={composeToQuery}
                    onChange={(e) => setComposeToQuery(e.target.value)}
                    placeholder="Search people…"
                    className="flex-1 text-[13px] text-[#1b1b1f] placeholder:text-[#8b8d94] outline-none"
                  />
                )}
              </div>

              {/* Person suggestions dropdown */}
              {filteredPersonSuggestions.length > 0 && (
                <div className="absolute left-4 right-4 top-full mt-1 overflow-hidden rounded-lg border border-[#e6e6e9] bg-white shadow-lg z-10 max-h-56 overflow-y-auto">
                  {filteredPersonSuggestions.map((p) => (
                    <button
                      key={p.email}
                      onMouseDown={(e) => { e.preventDefault(); setComposeTo(p); setComposeToQuery(""); }}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[#f9f9fb] transition-colors"
                    >
                      <LetterAvatar name={p.name} size="sm" src={profilePicMap.get(p.email.toLowerCase())} />
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium text-[#1b1b1f] truncate">{p.name}</p>
                        <p className="text-[11px] text-[#8b8d94] truncate">{p.email}{p.companyName ? ` · ${p.companyName}` : ""}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Subject field */}
            <div className="border-b border-[#f0f0f2] px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-[#8b8d94] shrink-0">Subject</span>
                <input
                  type="text"
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  placeholder="Email subject"
                  className="flex-1 text-[13px] text-[#1b1b1f] placeholder:text-[#8b8d94] outline-none"
                />
              </div>
            </div>

            {/* Body */}
            <textarea
              ref={composeBodyRef}
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void sendCompose(); }
              }}
              placeholder="Write your message…"
              className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-[13px] text-[#1b1b1f] placeholder:text-[#8b8d94] outline-none"
              style={{ minHeight: 200 }}
            />
            {emailSignature && (
              <div className="mx-4 mb-2 border-t border-[#f0f0f2] pt-2">
                <div className="text-[13px] text-[#8b8d94] leading-relaxed [&_p]:m-0 [&_a]:text-[#5e6ad2] [&_a]:underline" dangerouslySetInnerHTML={{ __html: emailSignature }} />
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-[#f0f0f2] px-3 py-2.5">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => void sendCompose()}
                  disabled={!composeTo || !composeSubject.trim() || !composeBody.trim() || composeSending}
                  className="flex items-center gap-1.5 rounded-lg bg-[#4338ca] px-3.5 py-1.5 text-[12px] font-medium text-white transition-opacity disabled:opacity-30 hover:bg-[#3730a3]"
                >
                  {composeSending ? (
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  ) : null}
                  Send
                </button>
                <div className="relative">
                  <button
                    onClick={() => { void fetchTemplates(); setShowComposeTemplatePicker((p) => !p); }}
                    className="flex items-center gap-1 rounded-lg border border-[#e6e6e9] px-2.5 py-1.5 text-[12px] font-medium text-[#6b6f76] hover:bg-[#f5f5f7] transition-colors"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                    Templates
                  </button>
                  {showComposeTemplatePicker && (
                    <div className="absolute left-0 bottom-full mb-1 w-64 rounded-lg border border-[#e6e6e9] bg-white shadow-lg z-20 overflow-hidden">
                      {emailTemplates.length === 0 ? (
                        <p className="px-3 py-3 text-[12px] text-[#8b8d94]">No templates yet</p>
                      ) : (
                        emailTemplates.map((t) => (
                          <button
                            key={t._id}
                            onClick={() => resolveTemplateForCompose(t)}
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
              </div>
              <div className="flex items-center gap-3 text-[#8b8d94]">
                <kbd className="rounded bg-black/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-[#8b8d94]">⌘↵</kbd>
              </div>
            </div>
          </div>
        </div>
      )}

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

            {/* Messages — fills remaining space, everything scrolls together */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 space-y-3">
              {loadingMessages ? (
                <div className="flex justify-center py-8">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
                </div>
              ) : messages.length === 0 ? (
                <p className="text-center text-[13px] text-[#8b8d94]">No messages</p>
              ) : (
                messages.map((msg, i) => (
                  <div key={msg.id}>
                    {i > 0 && <div className="border-t border-[#f0f0f2] mx-3" />}
                    <MessageBubble
                      msg={msg}
                      myEmails={myEmails}
                      isLast={i === messages.length - 1}
                      tracking={trackingData.find((t) => {
                        // Match tracking record to message by sent time proximity (within 5 minutes)
                        const msgTime = new Date(msg.date).getTime();
                        const sentTime = new Date(t.sentAt).getTime();
                        return Math.abs(msgTime - sentTime) < 5 * 60 * 1000;
                      }) ?? null}
                    />
                  </div>
                ))
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Pinned bottom: action buttons + reply/comments panels */}
            {messages.length > 0 && !loadingMessages && (
              <div className="shrink-0 border-t border-[#e6e6e9] px-5 pb-3">
                <div className="flex items-center gap-2 py-3">
                  <button
                    onClick={() => { setActivePanel(activePanel === "reply" ? null : "reply"); setTimeout(() => replyRef.current?.focus(), 50); }}
                    className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors shadow-sm ${
                      activePanel === "reply"
                        ? "border-[#1b1b1f] bg-[#1b1b1f] text-white"
                        : "border-[#e6e6e9] bg-white text-[#1b1b1f] hover:bg-[#f5f5f7]"
                    }`}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                    </svg>
                    Reply
                  </button>
                  <button
                    onClick={() => void generateAIDraft()}
                    disabled={draftingAI}
                    className="flex items-center gap-1.5 rounded-full border border-[#e6e6e9] bg-white px-3.5 py-1.5 text-[12px] font-medium text-[#1b1b1f] hover:bg-[#f5f5f7] transition-colors shadow-sm disabled:opacity-50"
                  >
                    {draftingAI ? (
                      <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/10 border-t-black/50" />
                    ) : (
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                      </svg>
                    )}
                    AI Draft
                  </button>
                  <button
                    onClick={() => { setActivePanel(activePanel === "comments" ? null : "comments"); }}
                    className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors shadow-sm ${
                      activePanel === "comments"
                        ? "border-[#1b1b1f] bg-[#1b1b1f] text-white"
                        : "border-[#e6e6e9] bg-white text-[#1b1b1f] hover:bg-[#f5f5f7]"
                    }`}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                    </svg>
                    Comments
                    {commentCount > 0 && (
                      <span className={`flex h-[16px] min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-semibold leading-none ${
                        activePanel === "comments" ? "bg-white text-[#1b1b1f]" : "bg-[#5e6ad2] text-white"
                      }`}>
                        {commentCount}
                      </span>
                    )}
                  </button>
                </div>

                {/* Inline reply card */}
                {activePanel === "reply" && (
                  <div className="relative rounded-xl border border-[#e6e6e9] bg-white shadow-sm overflow-hidden mb-2">
                    {/* To header */}
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#f0f0f2]">
                      <div className="flex items-center gap-2 text-[12px] text-[#8b8d94]">
                        <span>To</span>
                        <span className="rounded-md bg-[#f5f5f7] px-2 py-0.5 text-[12px] font-medium text-[#1b1b1f]">
                          {selectedThread?.personName ?? selectedThread?.personEmail}
                        </span>
                      </div>
                    </div>

                    {/* Textarea */}
                    <textarea
                      ref={replyRef}
                      value={replyBody}
                      onChange={(e) => {
                        handleReplyChange(e);
                        e.target.style.height = "auto";
                        e.target.style.height = Math.max(100, e.target.scrollHeight) + "px";
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          void sendReply();
                        }
                        if (e.key === "Escape") setMentionQuery(null);
                      }}
                      placeholder={draftingAI ? "AI is drafting a reply…" : "Write a reply…"}
                      className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-[13px] text-[#1b1b1f] placeholder:text-[#8b8d94] outline-none"
                      style={{ minHeight: 100, maxHeight: 200, overflowY: "auto" }}
                    />
                    {emailSignature && (
                      <div className="mx-4 mb-2 border-t border-[#f0f0f2] pt-2">
                        <div className="text-[13px] text-[#8b8d94] leading-relaxed [&_p]:m-0 [&_a]:text-[#5e6ad2] [&_a]:underline" dangerouslySetInnerHTML={{ __html: emailSignature }} />
                      </div>
                    )}

                    {/* Footer actions */}
                    <div className="flex items-center justify-between px-3 py-2.5 border-t border-[#f0f0f2]">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={sendReply}
                          disabled={!replyBody.trim() || sendingReply}
                          className="flex items-center gap-1.5 rounded-lg bg-[#4338ca] px-3.5 py-1.5 text-[12px] font-medium text-white transition-opacity disabled:opacity-30 hover:bg-[#3730a3]"
                        >
                          {sendingReply ? (
                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                          ) : null}
                          Send
                        </button>
                        <div className="relative">
                          <button
                            onClick={() => { void fetchTemplates(); setShowTemplatePicker((p) => !p); }}
                            className="flex items-center gap-1 rounded-lg border border-[#e6e6e9] px-2.5 py-1.5 text-[12px] font-medium text-[#6b6f76] hover:bg-[#f5f5f7] transition-colors"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                            </svg>
                            Templates
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
                      </div>
                      <div className="flex items-center gap-3 text-[#8b8d94]">
                        <kbd className="rounded bg-black/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-[#8b8d94]">⌘↵</kbd>
                        <button
                          onClick={() => { setActivePanel(null); setReplyBody(""); }}
                          className="p-1 rounded hover:bg-black/[0.04] hover:text-[#6b6f76] transition-colors"
                          title="Discard"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* @ mention dropdown */}
                    {mentionQuery !== null && filteredMentionMembers.length > 0 && (
                      <div className="absolute left-4 bottom-16 w-60 overflow-hidden rounded-lg border border-[#e6e6e9] bg-white shadow-md z-10">
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
                )}

                {/* Inline comments card */}
                {activePanel === "comments" && (
                  <div className="rounded-xl border border-[#e6e6e9] bg-white shadow-sm overflow-hidden mb-2">
                    <InternalComments
                      threadId={selectedThread!.id}
                      authToken={authToken}
                      apiBaseUrl={apiBaseUrl}
                      connectedUsers={connectedUsers}
                      onCountChange={setCommentCount}
                    />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
