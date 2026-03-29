"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { dispatchDataChanged, safeJson, GLOBAL_ACTION_EVENT } from "./components";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

/* ------------------------------------------------------------------ */
/*  Sidebar nav items                                                  */
/* ------------------------------------------------------------------ */

interface UserProfile {
  email: string;
  fullName?: string | null;
  profilePhotoUrl?: string | null;
}

const MI = ({ name }: { name: string }) => (
  <span className="material-symbols-outlined">{name}</span>
);

const navItems = [
  { label: "Home", href: "/dashboard", icon: <MI name="home" /> },
  { label: "Inbox", href: "/dashboard/inbox", icon: <MI name="inbox" /> },
  { label: "Buyer Profile", href: "/dashboard/buyer-profiles", icon: <MI name="badge" /> },
  { label: "Skills", href: "/dashboard/skills", icon: <MI name="category_search" /> },
  { label: "Triggers", href: "/dashboard/triggers", icon: <MI name="bolt" /> },
  { label: "Meetings", href: "/dashboard/calendar", icon: <MI name="calendar_month" /> },
];

const recordNavItems = [
  { label: "Companies", href: "/dashboard/companies", icon: <MI name="corporate_fare" /> },
  { label: "People", href: "/dashboard/people", icon: <MI name="article_person" /> },
];

/* ------------------------------------------------------------------ */
/*  Global Action Modal                                                */
/* ------------------------------------------------------------------ */

type GlobalActionType = "company" | "person" | null;

function GlobalActionModal({
  actionType,
  onClose,
  apiBaseUrl,
  authToken,
}: {
  actionType: GlobalActionType;
  onClose: () => void;
  apiBaseUrl: string;
  authToken: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  if (!actionType) return null;

  const isCompany = actionType === "company";
  const title = isCompany ? "Add Company" : "Add Person";
  const isEmail = !isCompany && value.includes("@") && !value.includes("linkedin.com");
  const placeholder = isCompany
    ? "Enter a domain (e.g. acme.com)"
    : "LinkedIn URL or work email (e.g. john@acme.com)";

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      if (isCompany) {
        const response = await fetch(`${apiBaseUrl}/companies`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ domain: value }),
        });
        const result = (await safeJson(response)) as { company?: unknown; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Could not add company");
        onClose();
        router.push("/dashboard/companies");
        dispatchDataChanged();
      } else if (isEmail) {
        const response = await fetch(`${apiBaseUrl}/persons/by-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ email: value.trim() }),
        });
        const result = (await safeJson(response)) as { person?: unknown; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Could not add person");
        onClose();
        router.push("/dashboard/people");
        dispatchDataChanged();
      } else {
        const linkedinUrl = value.startsWith("http") ? value : `https://www.linkedin.com/in/${value}`;
        const response = await fetch(`${apiBaseUrl}/persons`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ linkedinUrl }),
        });
        const result = (await safeJson(response)) as { person?: unknown; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Could not add person");
        onClose();
        router.push("/dashboard/people");
        dispatchDataChanged();
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Something went wrong";
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[20vh] backdrop-blur-[2px]" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-md flex-col rounded-2xl bg-white shadow-xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-5">
          <h2 className="text-[20px] font-bold text-zinc-900">{title}</h2>
          <button type="button" onClick={onClose} className="ml-4 mt-0.5 rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pb-5">
          <label className="block text-[13px] font-semibold text-zinc-800 mb-2">
            {isCompany ? "Domain" : isEmail ? "Work Email" : "LinkedIn URL"}
          </label>
          <input
            className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-[13px] placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none transition-all"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            autoFocus
            required
          />
          {isEmail && (
            <p className="mt-1.5 text-[12px] text-zinc-400">
              We&apos;ll enrich their profile via Fiber and auto-create their company.
            </p>
          )}
          {error && (
            <p className="mt-2 text-[13px] text-red-600">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-zinc-200 px-5 py-2.5 text-[13px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="rounded-xl bg-zinc-900 px-5 py-2.5 text-[13px] font-semibold text-white transition-all hover:bg-black disabled:opacity-60"
          >
            {isLoading ? "Adding..." : title}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar Component                                                  */
/* ------------------------------------------------------------------ */

function Sidebar({
  userProfile,
  onLogout,
  onGlobalAction,
}: {
  userProfile: UserProfile;
  onLogout: () => void;
  onGlobalAction: (type: GlobalActionType) => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);

  const displayName = userProfile.fullName ?? userProfile.email;
  const userInitial = displayName.charAt(0).toUpperCase();

  return (
    <aside className="relative flex h-screen w-[220px] shrink-0 flex-col bg-white shadow-[inset_-1px_0_0_0_#e8e8e8]">
      <div className="flex items-center gap-2.5 px-5 pt-4 pb-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="sidr" className="shrink-0 object-contain" style={{ width: 60, height: 60 }} />

      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-5">
        <div className="flex flex-col gap-0.5">
          {navItems.map((item) => {
            const isActive = item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className={`group flex w-full items-center cursor-pointer gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition-all active:scale-[0.97] active:opacity-70 ${
                  isActive
                    ? "font-bold text-[#050505]"
                    : "font-medium text-black/50 hover:text-black/80 hover:bg-black/[0.03]"
                }`}
              >
                <span className={`shrink-0 transition-colors ${isActive ? "text-[#050505]" : "text-black/30 group-hover:text-black/50"}`}>
                  {item.icon}
                </span>
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-col gap-0.5">
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-black/30">Records</p>
          {recordNavItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className={`group flex w-full items-center cursor-pointer gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition-all active:scale-[0.97] active:opacity-70 ${
                  isActive
                    ? "font-bold text-[#050505]"
                    : "font-medium text-black/50 hover:text-black/80 hover:bg-black/[0.03]"
                }`}
              >
                <span className={`shrink-0 transition-colors ${isActive ? "text-[#050505]" : "text-black/30 group-hover:text-black/50"}`}>
                  {item.icon}
                </span>
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Add + button */}
      <div className="relative px-3 pb-3">
        <button
          onClick={() => setShowAddMenu((v) => !v)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-black/[0.08] bg-white py-2.5 text-[14px] font-semibold text-black/70 transition-all hover:bg-black/[0.03] active:scale-[0.97] active:opacity-70"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add
        </button>

        {showAddMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />
            <div className="absolute bottom-full left-3 right-3 z-50 mb-1.5 rounded-xl border border-black/[0.06] bg-white py-1 shadow-lg">
              <button
                onClick={() => { setShowAddMenu(false); onGlobalAction("company"); }}
                className="flex w-full items-center px-3.5 py-2.5 text-[13px] text-black/60 transition-colors hover:bg-black/[0.03] hover:text-black"
              >
                Company
              </button>
              <button
                onClick={() => { setShowAddMenu(false); onGlobalAction("person"); }}
                className="flex w-full items-center px-3.5 py-2.5 text-[13px] text-black/60 transition-colors hover:bg-black/[0.03] hover:text-black"
              >
                Person
              </button>
            </div>
          </>
        )}
      </div>

      <div className="relative px-3 pb-3 pt-2 shadow-[inset_0_1px_0_0_#e8e8e8]">
        <button
          onClick={() => setShowUserMenu((v) => !v)}
          className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 transition-all hover:bg-black/[0.03] active:scale-[0.98] active:opacity-70"
        >
          <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-[#e3e8ee] ring-2 ring-white">
            {userProfile.profilePhotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={userProfile.profilePhotoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-[#4f566b]">
                {userInitial}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-[13px] font-medium text-[#1a1f36]">{displayName}</p>
            {userProfile.fullName && (
              <p className="truncate text-[11px] text-[#a3acb9]">{userProfile.email}</p>
            )}
          </div>
          <svg className="h-4 w-4 shrink-0 text-[#a3acb9]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
          </svg>
        </button>

        {showUserMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
            <div className="absolute bottom-full left-3 right-3 z-50 mb-1.5 rounded-xl border border-[#e3e8ee] bg-white py-1 shadow-lg animate-fade-in">
              <div className="border-b border-[#e3e8ee] px-3.5 py-2.5">
                <p className="text-[13px] font-medium text-[#1a1f36]">{displayName}</p>
                <p className="mt-0.5 truncate text-[11px] text-[#a3acb9]">{userProfile.email}</p>
              </div>
              <button
                onClick={() => { setShowUserMenu(false); router.push("/dashboard/settings/profile"); }}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-[13px] text-[#4f566b] transition-colors hover:bg-[#f7fafc] hover:text-[#1a1f36]"
              >
                <svg className="h-4 w-4 shrink-0 text-[#a3acb9]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
                Profile settings
              </button>
              <button
                onClick={() => { setShowUserMenu(false); router.push("/dashboard/settings/workspace"); }}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-[13px] text-[#4f566b] transition-colors hover:bg-[#f7fafc] hover:text-[#1a1f36]"
              >
                <svg className="h-4 w-4 shrink-0 text-[#a3acb9]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                </svg>
                Workspace settings
              </button>
              <div className="my-1 border-t border-[#e3e8ee]" />
              <button
                onClick={() => { setShowUserMenu(false); onLogout(); }}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-[13px] text-red-500 transition-colors hover:bg-red-50"
              >
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/*  Dashboard Layout                                                   */
/* ------------------------------------------------------------------ */

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authToken, setAuthToken] = useState("");
  const [globalAction, setGlobalAction] = useState<GlobalActionType>(null);

  useEffect(() => {
    function handleGlobalActionEvent(e: Event) {
      const detail = (e as CustomEvent<{ type: "company" | "person" }>).detail;
      setGlobalAction(detail.type);
    }
    window.addEventListener(GLOBAL_ACTION_EVENT, handleGlobalActionEvent);
    return () => window.removeEventListener(GLOBAL_ACTION_EVENT, handleGlobalActionEvent);
  }, []);

  useEffect(() => {
    const storedToken = window.localStorage.getItem(localStorageTokenKey);
    if (!storedToken) {
      router.replace("/");
      return;
    }

    setAuthToken(storedToken);

    void fetch(`${apiBaseUrl}/me`, {
      headers: { Authorization: `Bearer ${storedToken}` },
    })
      .then(async (response) => {
        if (!response.ok) {
          window.localStorage.removeItem(localStorageTokenKey);
          router.replace("/");
          return;
        }
        const data = (await safeJson(response)) as {
          email: string;
          onboardingComplete?: boolean;
          user?: { fullName?: string | null; profilePhotoUrl?: string | null };
        };
        if (!data.onboardingComplete) {
          router.replace("/onboarding");
          return;
        }
        setUserProfile({
          email: data.email,
          fullName: data.user?.fullName ?? null,
          profilePhotoUrl: data.user?.profilePhotoUrl ?? null,
        });
      })
      .catch(() => {
        window.localStorage.removeItem(localStorageTokenKey);
        router.replace("/");
      });
  }, [apiBaseUrl, router]);

  function handleLogout(): void {
    window.localStorage.removeItem(localStorageTokenKey);
    router.replace("/");
  }

  if (!userProfile) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f7fafc]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#e3e8ee] border-t-[#5469d4]" />
          <p className="text-[13px] text-[#a3acb9]">Loading workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar userProfile={userProfile} onLogout={handleLogout} onGlobalAction={setGlobalAction} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
      <GlobalActionModal
        actionType={globalAction}
        onClose={() => setGlobalAction(null)}
        apiBaseUrl={apiBaseUrl}
        authToken={authToken}
      />
    </div>
  );
}
