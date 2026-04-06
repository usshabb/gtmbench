"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { safeJson, apiFetch } from "../components";

interface BuyerProfile {
  _id: string;
  name: string;
  titles: string[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Person {
  _id: string;
  linkedinUrl: string;
  enrichmentData?: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getFiberData(person: Person): Record<string, any> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = person.enrichmentData as any;
    return raw?.output?.data?.[0] ?? null;
  } catch {
    return null;
  }
}

function getPersonTitle(person: Person): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = getFiberData(person) as any;
  return (data?.current_job?.title as string | undefined) ?? undefined;
}

function getPersonPhoto(person: Person): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = getFiberData(person) as any;
  return (data?.profile_pic as string | undefined) ?? undefined;
}

function getPersonName(person: Person): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = getFiberData(person) as any;
  if (data?.name) return data.name as string;
  const parts = [data?.first_name, data?.last_name].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return person.linkedinUrl.split("/in/")[1]?.replace(/\/$/, "") ?? "?";
}

function matchPersonsToProfile(persons: Person[], profile: BuyerProfile): Person[] {
  const lcTitles = profile.titles.map((t) => t.toLowerCase());
  return persons.filter((p) => {
    const t = getPersonTitle(p);
    if (!t) return false;
    const lct = t.toLowerCase();
    return lcTitles.some((pt) => lct.includes(pt) || pt.includes(lct));
  });
}

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

/* ------------------------------------------------------------------ */
/*  Profile Form Modal                                                  */
/* ------------------------------------------------------------------ */

function ProfileFormModal({
  profile,
  onClose,
  onSaved,
  apiBaseUrl,
  authToken,
}: {
  profile: BuyerProfile | null;
  onClose: () => void;
  onSaved: () => void;
  apiBaseUrl: string;
  authToken: string;
}) {
  const [name, setName] = useState(profile?.name ?? "");
  const [titles, setTitles] = useState<string[]>(profile?.titles ?? []);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const isEditing = profile !== null;

  function commitInput(raw: string) {
    const parts = raw.split(",").map((t) => t.trim()).filter(Boolean);
    if (parts.length === 0) return;
    setTitles((prev) => {
      const next = [...prev];
      for (const p of parts) {
        if (!next.includes(p)) next.push(p);
      }
      return next;
    });
    setInputValue("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitInput(inputValue);
    } else if (e.key === "Backspace" && inputValue === "" && titles.length > 0) {
      setTitles((prev) => prev.slice(0, -1));
    }
  }

  function removeTitle(i: number) {
    setTitles((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Commit any pending input before saving
    const pending = inputValue.split(",").map((t) => t.trim()).filter(Boolean);
    const allTitles = [...titles, ...pending.filter((p) => !titles.includes(p))];

    if (allTitles.length === 0) {
      setError("Add at least one title");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const url = isEditing
        ? `${apiBaseUrl}/buyer-profiles/${profile._id}`
        : `${apiBaseUrl}/buyer-profiles`;

      const response = await apiFetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ name: name.trim(), titles: allTitles }),
      });

      const result = (await safeJson(response)) as { profile?: unknown; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Something went wrong");

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[12vh] backdrop-blur-[2px]" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-lg flex-col rounded-lg bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <h2 className="text-[17px] font-semibold text-[#1b1b1f]">
            {isEditing ? "Edit Buyer Profile" : "New Buyer Profile"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[#8b8d94] transition-colors hover:bg-[#ededf0] hover:text-[#6b6f76]"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 pb-5 space-y-6">
          {/* Profile Name */}
          <div>
            <label className="block text-[14px] font-semibold text-[#1b1b1f] mb-2">Profile Name</label>
            <input
              className="w-full rounded-md border border-[#e6e6e9] bg-white px-4 py-3 text-[14px] text-[#1b1b1f] placeholder:text-[#8b8d94] focus:border-[#5e6ad2] focus:ring-1 focus:ring-[#5e6ad2]/20 focus:outline-none transition-colors"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Enterprise Sales Leaders"
              autoFocus
              required
            />
          </div>

          {/* Titles — tag input */}
          <div>
            <label className="block text-[14px] font-semibold text-[#1b1b1f] mb-1">Titles</label>
            <p className="text-[13px] text-[#8b8d94] mb-3">Job titles that describe who you are selling to</p>

            {/* Tag box */}
            <div
              className="flex min-h-[52px] flex-wrap gap-2 rounded-md border border-[#e6e6e9] bg-white px-3.5 py-2.5 cursor-text focus-within:border-[#5e6ad2] focus-within:ring-1 focus-within:ring-[#5e6ad2]/20 transition-colors"
              onClick={() => inputRef.current?.focus()}
            >
              {titles.map((title, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#f5f5f7] pl-2.5 pr-1.5 py-1 text-[13px] font-medium text-[#6b6f76]"
                >
                  {title}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeTitle(i); }}
                    className="flex h-4 w-4 items-center justify-center rounded-full text-[#8b8d94] hover:bg-[#d4d4d8] hover:text-[#6b6f76] transition-colors"
                  >
                    <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => commitInput(inputValue)}
                placeholder={titles.length === 0 ? "VP of Sales, CRO, Head of Growth…" : "Add title…"}
                className="min-w-[140px] flex-1 bg-transparent text-[13px] text-[#1b1b1f] placeholder:text-[#8b8d94] outline-none"
              />
            </div>
            <p className="mt-2 text-[12px] text-[#8b8d94]">Press Enter or comma to add · Backspace to remove last</p>
          </div>

          {error && <p className="text-[13px] text-red-500">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#ededf0] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#e6e6e9] px-4 py-2 text-[14px] font-medium text-[#6b6f76] transition-colors hover:bg-[#f5f5f7]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="rounded-md bg-[#1b1b1f] px-4 py-2 text-[14px] font-semibold text-white transition-all hover:bg-[#2c2c33] disabled:opacity-60"
          >
            {isLoading ? "Saving…" : isEditing ? "Save Changes" : "Create Profile"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Person Avatar                                                       */
/* ------------------------------------------------------------------ */

function personInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function PersonAvatar({ person, size = 8 }: { person: Person; size?: number }) {
  const photo = getPersonPhoto(person);
  const name = getPersonName(person);
  const [imgError, setImgError] = useState(false);

  const cls = `flex items-center justify-center rounded-full border-2 border-white bg-[#e6e6e9] text-[#6b6f76] text-[10px] font-semibold`;
  const style = { width: `${size * 4}px`, height: `${size * 4}px` };

  if (photo && !imgError) {
    return (
      <img
        src={photo}
        alt={name}
        className="rounded-full border-2 border-white object-cover"
        style={style}
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <div className={cls} style={{ ...style, border: "2px solid white" }}>
      {personInitials(name)}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Profile Card                                                        */
/* ------------------------------------------------------------------ */

const VISIBLE_TAGS = 6;
const MAX_AVATARS = 4;

function ProfileCard({
  profile,
  matchedPersons,
  onEdit,
  onDelete,
  onSetDefault,
}: {
  profile: BuyerProfile;
  matchedPersons: Person[];
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [showMore, setShowMore] = useState(false);

  const visibleTags = profile.titles.slice(0, VISIBLE_TAGS);
  const hiddenTags = profile.titles.slice(VISIBLE_TAGS);

  const shownAvatars = matchedPersons.slice(0, MAX_AVATARS);
  const overflowCount = matchedPersons.length - shownAvatars.length;
  const personCount = matchedPersons.length;

  return (
    <div
      className={`group relative flex flex-col rounded-lg border bg-white px-4 py-3 transition-all hover:border-[#d4d4d8] ${profile.isDefault ? "border-[#d4d4d8]" : "border-[#e6e6e9]"}`}
      onClick={onEdit}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[14px] font-medium leading-tight text-[#1b1b1f]">{profile.name}</h3>
            {profile.isDefault && (
              <span className="shrink-0 rounded-md bg-[#f5f5f7] px-2 py-0.5 text-[10px] font-medium text-[#6b6f76]">
                Default
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12px] text-[#8b8d94]">
            {profile.titles.length} {profile.titles.length === 1 ? "title" : "titles"}
            {personCount > 0 && (
              <> · <span className="text-[#6b6f76]">{personCount} {personCount === 1 ? "person" : "people"}</span></>
            )}
          </p>
        </div>

        {/* 3-dot menu */}
        <div className="relative z-10">
          <button
            onClick={(e) => { e.stopPropagation(); setShowMenu((v) => !v); }}
            className="flex h-7 w-7 items-center justify-center rounded-full text-[#8b8d94] transition-all hover:bg-[#ededf0] hover:text-[#6b6f76]"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-20" onClick={(e) => { e.stopPropagation(); setShowMenu(false); }} />
              <div className="absolute right-0 top-8 z-30 w-40 rounded-lg border border-[#e6e6e9] bg-white py-1 shadow-lg">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowMenu(false); onEdit(); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[#6b6f76] hover:bg-[#f5f5f7] transition-colors"
                >
                  Edit
                </button>
                {!profile.isDefault && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowMenu(false); onSetDefault(); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[#6b6f76] hover:bg-[#f5f5f7] transition-colors"
                  >
                    Set as default
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); setShowMenu(false); onDelete(); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-red-600 hover:bg-red-50 transition-colors"
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Matched person avatars */}
      {matchedPersons.length > 0 && (
        <div className="mt-3 flex items-center">
          {shownAvatars.map((person, i) => (
            <div
              key={person._id}
              className="relative"
              style={{ marginLeft: i > 0 ? "-6px" : 0, zIndex: shownAvatars.length - i }}
            >
              <PersonAvatar person={person} size={7} />
            </div>
          ))}
          {overflowCount > 0 && (
            <div
              className="relative flex items-center justify-center rounded-full border-2 border-white bg-[#f5f5f7] text-[10px] font-semibold text-[#6b6f76]"
              style={{ width: 28, height: 28, marginLeft: "-6px", zIndex: 0 }}
            >
              +{overflowCount}
            </div>
          )}
        </div>
      )}

      {/* Title tags */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {visibleTags.map((title, i) => (
          <span
            key={i}
            className="rounded-md bg-[#f5f5f7] px-2 py-0.5 text-[11px] font-medium text-[#6b6f76]"
          >
            {title}
          </span>
        ))}
        {hiddenTags.length > 0 && (
          <span
            className="relative cursor-default rounded-md bg-[#e6e6e9] px-2 py-0.5 text-[11px] font-medium text-[#6b6f76]"
            onMouseEnter={() => setShowMore(true)}
            onMouseLeave={() => setShowMore(false)}
          >
            +{hiddenTags.length} more
            {showMore && (
              <div className="absolute bottom-full left-0 z-20 mb-2 w-60 rounded-lg bg-[#1b1b1f] p-3 shadow-xl">
                <div className="flex flex-wrap gap-1.5">
                  {hiddenTags.map((t, j) => (
                    <span key={j} className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Add Profile Card                                                    */
/* ------------------------------------------------------------------ */

function AddProfileCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-[#d4d4d8] bg-white transition-all hover:border-[#d4d4d8] hover:bg-[#f5f5f7] min-h-[200px]"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-[#d4d4d8] text-[#8b8d94] transition-colors group-hover:border-[#8b8d94] group-hover:text-[#8b8d94]">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      </div>
      <p className="mt-3 text-[14px] font-medium text-[#8b8d94] transition-colors group-hover:text-[#6b6f76]">
        Add a Buyer Profile
      </p>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Buyer Profiles Page                                                 */
/* ------------------------------------------------------------------ */

export default function BuyerProfilesPage() {
  const router = useRouter();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const [authToken, setAuthToken] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [profiles, setProfiles] = useState<BuyerProfile[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<BuyerProfile | null>(null);

  useEffect(() => {
    const storedToken = window.localStorage.getItem(localStorageTokenKey);
    if (!storedToken) {
      router.replace("/");
      return;
    }
    setAuthToken(storedToken);
  }, [router]);

  function fetchProfiles() {
    if (!authToken) return;
    setIsLoading(true);
    void Promise.all([
      apiFetch(`${apiBaseUrl}/buyer-profiles`, { headers: { Authorization: `Bearer ${authToken}` } }),
      apiFetch(`${apiBaseUrl}/persons`, { headers: { Authorization: `Bearer ${authToken}` } }),
    ])
      .then(async ([profilesRes, personsRes]) => {
        const profilesResult = (await safeJson(profilesRes)) as { profiles?: BuyerProfile[]; error?: string };
        if (!profilesRes.ok) throw new Error(profilesResult.error ?? "Could not load profiles");
        setProfiles(profilesResult.profiles ?? []);

        const personsResult = (await safeJson(personsRes)) as { persons?: Person[] };
        setPersons(personsResult.persons ?? []);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load profiles");
      })
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    fetchProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBaseUrl, authToken]);

  async function handleSetDefault(id: string) {
    try {
      const response = await apiFetch(`${apiBaseUrl}/buyer-profiles/${id}/set-default`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) {
        const result = (await safeJson(response)) as { error?: string };
        throw new Error(result.error ?? "Could not set default");
      }
      // Update local state
      setProfiles((prev) =>
        prev.map((p) => ({ ...p, isDefault: p._id === id })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set default");
    }
  }

  async function handleDelete(id: string) {
    try {
      const response = await apiFetch(`${apiBaseUrl}/buyer-profiles/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) {
        const result = (await safeJson(response)) as { error?: string };
        throw new Error(result.error ?? "Could not delete profile");
      }
      setProfiles((prev) => prev.filter((p) => p._id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete profile");
    }
  }

  function openCreate() {
    setEditingProfile(null);
    setModalOpen(true);
  }

  function openEdit(profile: BuyerProfile) {
    setEditingProfile(profile);
    setModalOpen(true);
  }

  return (
    <div className="flex h-full flex-col bg-white">
      {error && <p className="px-6 pt-4 text-[13px] text-red-400">{error}</p>}

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {/* Header */}
          <p className="text-[13px] text-[#6b6f76] leading-relaxed">
            Define who you are selling to. Buyer profiles match tracked people by job title so you can focus on the right contacts.
          </p>

          {/* Create button */}
          <div className="mt-4 flex items-center justify-end">
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 rounded-md border border-[#e6e6e9] bg-white px-3 py-1.5 text-[13px] font-medium text-[#6b6f76] transition-all hover:bg-[#f5f5f7]"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Create profile
            </button>
          </div>

          {/* Profiles grid */}
          <div className="mt-5">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {profiles.map((profile) => (
                  <ProfileCard
                    key={profile._id}
                    profile={profile}
                    matchedPersons={matchPersonsToProfile(persons, profile)}
                    onEdit={() => openEdit(profile)}
                    onDelete={() => handleDelete(profile._id)}
                    onSetDefault={() => handleSetDefault(profile._id)}
                  />
                ))}
              </div>
            )}
            {!isLoading && profiles.length === 0 && (
              <div className="flex items-center justify-center py-16">
                <p className="text-[14px] text-[#8b8d94]">No buyer profiles yet</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal */}
      {modalOpen && (
        <ProfileFormModal
          profile={editingProfile}
          onClose={() => setModalOpen(false)}
          onSaved={fetchProfiles}
          apiBaseUrl={apiBaseUrl}
          authToken={authToken}
        />
      )}
    </div>
  );
}
