"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, LetterAvatar, safeJson } from "../components";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

type JobType =
  | "getLinkedinContent"
  | "enrichLinkedinProfile"
  | "getEmail"
  | "getJobsbyCompany"
  | "getRecentlyFundedCompany";

interface Notification {
  _id: string;
  userEmail?: string;
  jobType: JobType;
  notificationText: string;
  subjectName?: string;
  subjectImageUrl?: string;
  createdAt: string;
}

/** Pull the subject name out of an existing notification text as a fallback
 *  for older rows that don't have subjectName persisted yet.
 *  All current notification templates use the phrasing "... for <name> on <date>". */
function extractSubjectName(text: string): string {
  const m = text.match(/ for (.+?) on /);
  return m ? m[1].trim() : "";
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (!Number.isFinite(diff) || diff < 0) return "now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function NotificationsPage() {
  const apiBaseUrl = getApiBaseUrl();
  const [token, setToken] = useState("");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async (authToken: string) => {
    setLoading(true);
    console.log("[notifications] GET /notifications");
    try {
      const res = await apiFetch(`${apiBaseUrl}/notifications?limit=200`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = (await safeJson(res)) as { notifications: Notification[] };
      setNotifications(data.notifications ?? []);
      console.log(`[notifications] loaded ${data.notifications?.length ?? 0}`);
    } catch (err) {
      console.error("[notifications] fetch failed", err);
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    const t = window.localStorage.getItem(localStorageTokenKey) ?? "";
    setToken(t);
    if (t) void fetchAll(t);
  }, [fetchAll]);

  async function deleteOne(id: string) {
    console.log(`[notifications] DELETE /notifications/${id}`);
    await apiFetch(`${apiBaseUrl}/notifications/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    setNotifications((prev) => prev.filter((n) => n._id !== id));
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          <h1 className="text-[20px] font-semibold text-[#1b1b1f]">Notifications</h1>

          <div className="mt-4">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-[13px] text-[#8b8d94]">No activity yet.</p>
              </div>
            ) : (
              <ul className="divide-y divide-[#f1f1f3]">
                {notifications.map((n) => {
                  const avatarName = n.subjectName?.trim() || extractSubjectName(n.notificationText) || "?";
                  return (
                    <li key={n._id} className="group flex items-center gap-2.5 py-2">
                      <LetterAvatar
                        name={avatarName}
                        src={n.subjectImageUrl ?? null}
                        size="xs"
                      />
                      <p className="min-w-0 flex-1 truncate text-[13px] text-[#1b1b1f]">
                        {n.notificationText}
                      </p>
                      <span className="shrink-0 text-[11px] tabular-nums text-[#b4b5ba]">
                        {relativeTime(n.createdAt)}
                      </span>
                      <button
                        onClick={() => deleteOne(n._id)}
                        className="shrink-0 rounded p-1 text-[#b4b5ba] opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 hover:text-red-600"
                        title="Delete"
                      >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
