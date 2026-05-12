"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, safeJson } from "../components";

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
  read: boolean;
  createdAt: string;
}

const JOB_TYPE_LABELS: Record<JobType, string> = {
  getLinkedinContent: "LinkedIn",
  enrichLinkedinProfile: "Profile",
  getEmail: "Email",
  getJobsbyCompany: "Jobs",
  getRecentlyFundedCompany: "Funding",
};

const JOB_TYPE_COLORS: Record<JobType, { bg: string; text: string }> = {
  getLinkedinContent: { bg: "bg-[#eef0ff]", text: "text-[#5e6ad2]" },
  enrichLinkedinProfile: { bg: "bg-[#f0f9ff]", text: "text-[#0369a1]" },
  getEmail: { bg: "bg-[#fef3c7]", text: "text-[#a16207]" },
  getJobsbyCompany: { bg: "bg-[#ecfdf5]", text: "text-[#059669]" },
  getRecentlyFundedCompany: { bg: "bg-[#fce7f3]", text: "text-[#be185d]" },
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (!Number.isFinite(diff) || diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function NotificationsPage() {
  const apiBaseUrl = getApiBaseUrl();
  const [token, setToken] = useState("");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const fetchNotifications = useCallback(async (authToken: string) => {
    setLoading(true);
    console.log("[notifications] GET /notifications");
    try {
      const res = await apiFetch(`${apiBaseUrl}/notifications?limit=200`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = (await safeJson(res)) as { notifications: Notification[]; unreadCount: number };
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
      console.log(`[notifications] loaded ${data.notifications?.length ?? 0} (${data.unreadCount ?? 0} unread)`);
    } catch (err) {
      console.error("[notifications] fetch failed", err);
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    const t = window.localStorage.getItem(localStorageTokenKey) ?? "";
    setToken(t);
    if (t) void fetchNotifications(t);
  }, [fetchNotifications]);

  async function markAllRead() {
    if (!token || unreadCount === 0) return;
    setMarking(true);
    console.log("[notifications] POST /notifications/mark-all-read");
    try {
      await apiFetch(`${apiBaseUrl}/notifications/mark-all-read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
      window.dispatchEvent(new CustomEvent("gtmbench:notifications-updated"));
    } finally {
      setMarking(false);
    }
  }

  async function markOneRead(id: string) {
    console.log(`[notifications] POST /notifications/${id}/read`);
    await apiFetch(`${apiBaseUrl}/notifications/${id}/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    setNotifications((prev) => prev.map((n) => (n._id === id ? { ...n, read: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    window.dispatchEvent(new CustomEvent("gtmbench:notifications-updated"));
  }

  async function deleteOne(id: string) {
    console.log(`[notifications] DELETE /notifications/${id}`);
    await apiFetch(`${apiBaseUrl}/notifications/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const wasUnread = notifications.find((n) => n._id === id && !n.read);
    setNotifications((prev) => prev.filter((n) => n._id !== id));
    if (wasUnread) setUnreadCount((prev) => Math.max(0, prev - 1));
    window.dispatchEvent(new CustomEvent("gtmbench:notifications-updated"));
  }

  const visible = filter === "unread" ? notifications.filter((n) => !n.read) : notifications;

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-[20px] font-semibold text-[#1b1b1f]">Notifications</h1>
              <p className="mt-0.5 text-[13px] text-[#6b6f76]">
                Activity from your synced LinkedIn profiles, jobs, and funding signals.
              </p>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                disabled={marking}
                className="shrink-0 rounded-md border border-[#e6e6e9] bg-white px-3 py-1.5 text-[12px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7] disabled:opacity-50"
              >
                {marking ? "Marking…" : `Mark all read (${unreadCount})`}
              </button>
            )}
          </div>

          {/* Filter tabs */}
          <div className="mt-4 inline-flex border-b border-[#e6e6e9]">
            {([
              { key: "all" as const, label: "All", count: notifications.length },
              { key: "unread" as const, label: "Unread", count: unreadCount },
            ]).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium transition-colors ${
                  filter === tab.key
                    ? "text-[#1b1b1f] border-b-2 border-[#1b1b1f]"
                    : "text-[#8b8d94] hover:text-[#6b6f76]"
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className={`rounded-full px-1.5 py-0 text-[10px] font-medium tabular-nums ${
                    filter === tab.key ? "bg-[#f5f5f7] text-[#6b6f76]" : "bg-[#f5f5f7] text-[#8b8d94]"
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* List */}
          <div className="mt-5">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
              </div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#e6e6e9] py-16 text-center">
                <svg className="h-8 w-8 text-[#d4d4d8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                </svg>
                <p className="mt-3 text-[14px] font-medium text-[#6b6f76]">
                  {filter === "unread" ? "No unread notifications" : "No notifications yet"}
                </p>
                <p className="mt-1 text-[12px] text-[#8b8d94]">
                  {filter === "unread"
                    ? "You're all caught up."
                    : "We'll log activity here as syncs run."}
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-[#e6e6e9] bg-white divide-y divide-[#f1f1f3]">
                {visible.map((n) => {
                  const color = JOB_TYPE_COLORS[n.jobType] ?? { bg: "bg-[#f5f5f7]", text: "text-[#6b6f76]" };
                  const label = JOB_TYPE_LABELS[n.jobType] ?? n.jobType;
                  return (
                    <div
                      key={n._id}
                      className={`group flex items-start gap-3 px-4 py-3 transition-colors ${
                        n.read ? "bg-white" : "bg-[#fafbff]"
                      }`}
                    >
                      {/* Unread indicator */}
                      <div className="pt-1.5 shrink-0">
                        <span
                          className={`block h-2 w-2 rounded-full ${
                            n.read ? "bg-transparent" : "bg-[#5e6ad2]"
                          }`}
                        />
                      </div>

                      {/* Type pill */}
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${color.bg} ${color.text}`}>
                        {label}
                      </span>

                      {/* Text */}
                      <div className="min-w-0 flex-1">
                        <p className={`text-[13px] leading-relaxed ${n.read ? "text-[#6b6f76]" : "text-[#1b1b1f] font-medium"}`}>
                          {n.notificationText}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[#8b8d94]">{relativeTime(n.createdAt)}</p>
                      </div>

                      {/* Actions */}
                      <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!n.read && (
                          <button
                            onClick={() => markOneRead(n._id)}
                            className="rounded p-1.5 text-[#8b8d94] hover:bg-[#f5f5f7] hover:text-[#6b6f76]"
                            title="Mark as read"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                          </button>
                        )}
                        <button
                          onClick={() => deleteOne(n._id)}
                          className="rounded p-1.5 text-[#8b8d94] hover:bg-red-50 hover:text-red-600"
                          title="Delete"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
