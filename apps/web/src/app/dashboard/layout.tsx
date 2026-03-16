"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { dispatchDataChanged } from "./components";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

/* ------------------------------------------------------------------ */
/*  Sidebar nav items                                                  */
/* ------------------------------------------------------------------ */

const navItems = [
  {
    label: "Signals",
    href: "/dashboard",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.651a3.75 3.75 0 010-5.303m5.304 0a3.75 3.75 0 010 5.303m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.79M12 12h.008v.007H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
      </svg>
    ),
  },
  {
    label: "Companies",
    href: "/dashboard/companies",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  },
  {
    label: "People",
    href: "/dashboard/people",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
  },
  {
    label: "Buyer Profile",
    href: "/dashboard/buyer-profiles",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15A2.25 2.25 0 002.25 6.75v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
      </svg>
    ),
  },
  {
    label: "Triggers",
    href: "/dashboard/triggers",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
      </svg>
    ),
  },
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
  const placeholder = isCompany
    ? "Enter a domain (e.g. acme.com)"
    : "Enter a LinkedIn URL (e.g. linkedin.com/in/johndoe)";

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      if (isCompany) {
        const response = await fetch(`${apiBaseUrl}/companies`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ domain: value }),
        });
        const result = (await response.json()) as { company?: unknown; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Could not add company");
        onClose();
        router.push("/dashboard/companies");
        dispatchDataChanged();
      } else {
        const linkedinUrl = value.startsWith("http") ? value : `https://www.linkedin.com/in/${value}`;
        const response = await fetch(`${apiBaseUrl}/persons`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ linkedinUrl }),
        });
        const result = (await response.json()) as { person?: unknown; error?: string };
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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[20vh]" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <h2 className="text-[15px] font-semibold text-zinc-900">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5">
          <label className="block text-[13px] font-medium text-zinc-700 mb-1.5">
            {isCompany ? "Domain" : "LinkedIn URL"}
          </label>
          <input
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px] placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
            type={isCompany ? "text" : "url"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            autoFocus
            required
          />
          {error && (
            <p className="mt-2 text-[13px] text-red-600">{error}</p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white transition-opacity disabled:opacity-60"
            >
              {isLoading ? "Adding..." : title}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar Component                                                  */
/* ------------------------------------------------------------------ */

function Sidebar({
  userEmail,
  onLogout,
  onGlobalAction,
}: {
  userEmail: string;
  onLogout: () => void;
  onGlobalAction: (type: GlobalActionType) => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);

  const userInitial = userEmail.charAt(0).toUpperCase();

  return (
    <aside className="flex h-screen w-[240px] shrink-0 flex-col border-r border-zinc-200 bg-zinc-50">
      {/* Workspace header */}
      <div className="flex h-[52px] items-center justify-between border-b border-zinc-200 px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 text-xs font-bold text-white">
            G
          </div>
          <span className="text-[13px] font-semibold text-zinc-900">GTMbench</span>
        </div>

        {/* Global add button */}
        <div className="relative">
          <button
            onClick={() => setShowAddMenu((v) => !v)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-200/60 hover:text-zinc-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>

          {showAddMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />
              <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
                <button
                  onClick={() => {
                    setShowAddMenu(false);
                    onGlobalAction("company");
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
                >
                  <svg className="h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  Add Company
                </button>
                <button
                  onClick={() => {
                    setShowAddMenu(false);
                    onGlobalAction("person");
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
                >
                  <svg className="h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                  Add Person
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        <div className="space-y-0.5">
          {navItems.map((item) => {
            const isActive = item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium transition-colors ${
                  isActive
                    ? "bg-zinc-200/70 text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-200/40 hover:text-zinc-900"
                }`}
              >
                <span className={isActive ? "text-zinc-700" : "text-zinc-400"}>
                  {item.icon}
                </span>
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* User section */}
      <div className="relative border-t border-zinc-200 p-2">
        <button
          onClick={() => setShowUserMenu((v) => !v)}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-zinc-200/40"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-300 text-xs font-semibold text-zinc-700">
            {userInitial}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-[13px] font-medium text-zinc-900">{userEmail}</p>
          </div>
          <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
          </svg>
        </button>

        {/* User dropdown */}
        {showUserMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
            <div className="absolute bottom-full left-2 right-2 z-50 mb-1 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
              <div className="border-b border-zinc-100 px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Account</p>
                <p className="mt-0.5 truncate text-[13px] text-zinc-700">{userEmail}</p>
              </div>
              <button
                onClick={() => {
                  setShowUserMenu(false);
                  onLogout();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
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
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState("");
  const [globalAction, setGlobalAction] = useState<GlobalActionType>(null);

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
        const data = (await response.json()) as { email: string };
        setUserEmail(data.email);
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

  if (!userEmail) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar userEmail={userEmail} onLogout={handleLogout} onGlobalAction={setGlobalAction} />
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
