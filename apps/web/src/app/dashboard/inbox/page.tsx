"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LetterAvatar, safeJson } from "../components";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
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
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const isThisYear = d.getFullYear() === now.getFullYear();
  if (isToday) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (isThisYear) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function parseDisplayName(emailHeader: string): { name: string; address: string } {
  // Parses "Display Name <email@domain.com>" or just "email@domain.com"
  const match = emailHeader.match(/^"?([^"<]+?)"?\s*<([^>]+)>$/);
  if (match) return { name: match[1].trim(), address: match[2].trim() };
  return { name: emailHeader.trim(), address: emailHeader.trim() };
}

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

  const [authToken, setAuthToken] = useState("");
  const [gmailConnected, setGmailConnected] = useState(false);
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [personEmails, setPersonEmails] = useState<{ email: string; name: string }[]>([]);
  const [connectedUsers, setConnectedUsers] = useState<{ email: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null); // filter by person email
  const [selectedUser, setSelectedUser] = useState<string | null>(null); // filter by source user email
  const checkedRef = useRef(false);

  const fetchInbox = useCallback(async (token: string, isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/inbox/emails`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = (await safeJson(res)) as { error?: string };
        throw new Error(data.error ?? "Failed to fetch inbox");
      }
      const data = (await safeJson(res)) as {
        threads: InboxThread[];
        personEmails: { email: string; name: string }[];
        connectedUsers?: { email: string; name: string }[];
      };
      setThreads(data.threads ?? []);
      setPersonEmails(data.personEmails ?? []);
      setConnectedUsers(data.connectedUsers ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inbox");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    const token = window.localStorage.getItem(localStorageTokenKey);
    if (!token) { router.replace("/"); return; }
    setAuthToken(token);
    if (checkedRef.current) return;
    checkedRef.current = true;

    void fetch(`${apiBaseUrl}/gmail/status`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = (await safeJson(res)) as { connected: boolean };
        setGmailConnected(data.connected);
        if (data.connected) void fetchInbox(token);
        else setLoading(false);
      })
      .catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connectGmail() {
    const res = await fetch(
      `${apiBaseUrl}/auth/google/url?returnPath=/dashboard/inbox`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );
    const data = (await safeJson(res)) as { url: string };
    if (data.url) window.location.href = data.url;
  }

  async function addAnotherAccount() {
    const res = await fetch(
      `${apiBaseUrl}/auth/google/url?returnPath=/dashboard/inbox`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );
    const data = (await safeJson(res)) as { url: string };
    if (data.url) window.location.href = data.url;
  }

  const filtered = useMemo(() => {
    let result = threads;
    if (selectedPerson) result = result.filter((t) => t.personEmail === selectedPerson);
    if (selectedUser) {
      result = result.filter((t) => t.sourceUserEmail === selectedUser);
    } else {
      // Deduplicate by thread id when showing all accounts
      const seen = new Set<string>();
      result = result.filter((t) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
    }
    return result;
  }, [threads, selectedPerson, selectedUser]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">Inbox</h1>
          <p className="text-[13px] text-zinc-500">
            Emails from all tracked people{connectedUsers.length > 1 ? ` · ${connectedUsers.length} Gmail accounts` : ""}
            {threads.length > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                {filtered.length}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {gmailConnected && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => void addAnotherAccount()}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-[12px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
              >
                + Add account
              </button>
              <button
                onClick={() => void fetchInbox(authToken, true)}
                disabled={refreshing}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-[12px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50"
              >
                <svg
                  className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          )}
          {!gmailConnected && (
            <button
              onClick={connectGmail}
              className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-zinc-700"
            >
              Connect Google
            </button>
          )}
        </div>
      </div>

      {/* Person filter pills */}
      {personEmails.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto border-b border-zinc-100 px-6 py-2 scrollbar-none">
          <button
            onClick={() => setSelectedPerson(null)}
            className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
              !selectedPerson
                ? "bg-zinc-900 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            All
          </button>
          {personEmails.map((p) => (
            <button
              key={p.email}
              onClick={() => setSelectedPerson(selectedPerson === p.email ? null : p.email)}
              className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                selectedPerson === p.email
                  ? "bg-zinc-900 text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* View as filter pills */}
      {connectedUsers.length > 1 && (
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
          </div>
        ) : !gmailConnected ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100">
              <svg className="h-7 w-7 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z" />
              </svg>
            </div>
            <p className="text-[14px] font-medium text-zinc-700">Connect Gmail to see your inbox</p>
            <p className="mt-1 max-w-xs text-[13px] text-zinc-400">
              Connect your Gmail account to view emails from all your tracked people in one place.
            </p>
            <button
              onClick={connectGmail}
              className="mt-5 rounded-lg bg-zinc-900 px-5 py-2.5 text-[13px] font-medium text-white hover:bg-zinc-700"
            >
              Connect Gmail
            </button>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-[13px] text-red-500">{error}</p>
            <button
              onClick={() => void fetchInbox(authToken, true)}
              className="mt-3 text-[12px] text-zinc-500 underline hover:text-zinc-700"
            >
              Try again
            </button>
          </div>
        ) : personEmails.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100">
              <svg className="h-7 w-7 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </div>
            <p className="text-[14px] font-medium text-zinc-700">No enriched people yet</p>
            <p className="mt-1 max-w-xs text-[13px] text-zinc-400">
              Add people and enrich their emails to see your conversation history here.
            </p>
            <Link
              href="/dashboard/people"
              className="mt-5 rounded-lg bg-zinc-900 px-5 py-2.5 text-[13px] font-medium text-white hover:bg-zinc-700"
            >
              Go to People
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-[13px] font-medium text-zinc-600">No emails found</p>
            <p className="mt-1 text-[12px] text-zinc-400">
              {selectedPerson
                ? "No conversations with this person yet."
                : "No email threads found with your tracked people."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {filtered.map((thread) => {
              const { name: fromName, address: fromAddress } = parseDisplayName(thread.from);
              const isSentByMe = !personEmails.some((p) =>
                thread.from.toLowerCase().includes(p.email.toLowerCase()),
              );

              return (
                <div
                  key={thread.id}
                  className="flex items-start gap-4 px-6 py-4 hover:bg-zinc-50/60 transition-colors"
                >
                  <LetterAvatar name={thread.personName ?? thread.personEmail} size="md" />

                  <div className="min-w-0 flex-1">
                    {/* Top row: person chip + subject + date */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold text-zinc-900 truncate">
                            {thread.subject}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-zinc-400 flex-wrap">
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                            {thread.personName ?? thread.personEmail}
                          </span>
                          <span>·</span>
                          <span>{isSentByMe ? `To: ${thread.personName ?? thread.personEmail}` : `From: ${fromName !== fromAddress ? fromName : fromAddress}`}</span>
                          {thread.sourceUserName && connectedUsers.length > 1 && (
                            <>
                              <span>·</span>
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600">
                                via {thread.sourceUserName}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <span className="shrink-0 text-[12px] text-zinc-400 mt-0.5">
                        {formatDate(thread.date)}
                      </span>
                    </div>

                    {/* Snippet */}
                    {thread.snippet && (
                      <p className="mt-1 text-[12px] leading-relaxed text-zinc-500 line-clamp-2">
                        {thread.snippet}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
