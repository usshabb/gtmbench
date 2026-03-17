"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { safeJson } from "../components";

interface BuyerProfile {
  _id: string;
  name: string;
  titles: string[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
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
  profile: BuyerProfile | null; // null = create mode
  onClose: () => void;
  onSaved: () => void;
  apiBaseUrl: string;
  authToken: string;
}) {
  const [name, setName] = useState(profile?.name ?? "");
  const [titles, setTitles] = useState<string[]>(profile?.titles ?? [""]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const isEditing = profile !== null;

  function handleTitleChange(index: number, value: string) {
    setTitles((prev) => prev.map((t, i) => (i === index ? value : t)));
  }

  function addTitle() {
    setTitles((prev) => [...prev, ""]);
  }

  function removeTitle(index: number) {
    if (titles.length <= 1) return;
    setTitles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError("");

    const filteredTitles = titles.map((t) => t.trim()).filter(Boolean);
    if (filteredTitles.length === 0) {
      setError("Add at least one title");
      setIsLoading(false);
      return;
    }

    try {
      const url = isEditing
        ? `${apiBaseUrl}/buyer-profiles/${profile._id}`
        : `${apiBaseUrl}/buyer-profiles`;

      const response = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ name: name.trim(), titles: filteredTitles }),
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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[15vh]" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <h2 className="text-[15px] font-semibold text-zinc-900">
            {isEditing ? "Edit Buyer Profile" : "New Buyer Profile"}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5">
          {/* Profile Name */}
          <label className="block text-[13px] font-medium text-zinc-700 mb-1.5">Profile Name</label>
          <input
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px] placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Enterprise Sales Leaders"
            autoFocus
            required
          />

          {/* Titles */}
          <div className="mt-4">
            <label className="block text-[13px] font-medium text-zinc-700 mb-1.5">Titles</label>
            <p className="text-[11px] text-zinc-400 mb-2">Job titles that describe who you are selling to</p>
            <div className="space-y-2">
              {titles.map((title, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px] placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
                    type="text"
                    value={title}
                    onChange={(e) => handleTitleChange(index, e.target.value)}
                    placeholder="e.g. VP of Sales"
                  />
                  {titles.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeTitle(index)}
                      className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addTitle}
              className="mt-2 flex items-center gap-1 text-[12px] font-medium text-zinc-500 transition-colors hover:text-zinc-700"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add another title
            </button>
          </div>

          {error && <p className="mt-3 text-[13px] text-red-600">{error}</p>}

          <div className="mt-5 flex justify-end gap-2">
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
              {isLoading ? "Saving..." : isEditing ? "Save Changes" : "Create Profile"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Profile Card                                                        */
/* ------------------------------------------------------------------ */

function ProfileCard({
  profile,
  onEdit,
  onDelete,
  onSetDefault,
}: {
  profile: BuyerProfile;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <div className={`group rounded-xl border bg-white p-4 transition-colors hover:border-zinc-300 ${profile.isDefault ? "border-zinc-900" : "border-zinc-200"}`}>
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold text-zinc-900">{profile.name}</h3>
            {profile.isDefault && (
              <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-white">Default</span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            {profile.titles.length} {profile.titles.length === 1 ? "title" : "titles"}
          </p>
        </div>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {!profile.isDefault && (
            <button
              onClick={onSetDefault}
              className="rounded-lg px-2 py-1 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
              title="Set as default"
            >
              Set Default
            </button>
          )}
          <button
            onClick={onEdit}
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
            title="Edit"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
          </button>
          {!showConfirm ? (
            <button
              onClick={() => setShowConfirm(true)}
              className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-500"
              title="Delete"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
            </button>
          ) : (
            <button
              onClick={onDelete}
              className="rounded-lg px-2 py-1 text-[11px] font-medium text-red-600 bg-red-50 transition-colors hover:bg-red-100"
            >
              Confirm
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {profile.titles.map((title, i) => (
          <span
            key={i}
            className="rounded-full bg-zinc-100 px-2.5 py-1 text-[12px] font-medium text-zinc-600"
          >
            {title}
          </span>
        ))}
      </div>
    </div>
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
    void fetch(`${apiBaseUrl}/buyer-profiles`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(async (response) => {
        const result = (await safeJson(response)) as { profiles?: BuyerProfile[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Could not load profiles");
        setProfiles(result.profiles ?? []);
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
      const response = await fetch(`${apiBaseUrl}/buyer-profiles/${id}/set-default`, {
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
      const response = await fetch(`${apiBaseUrl}/buyer-profiles/${id}`, {
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
    <div className="flex h-full flex-col">
      {/* Page header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">Buyer Profiles</h1>
          <p className="text-[13px] text-zinc-500">
            {profiles.length} {profiles.length === 1 ? "profile" : "profiles"}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Profile
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="border-b border-zinc-200 bg-zinc-50 px-6 py-2.5">
          <p className="text-[13px] text-zinc-600">{error}</p>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
            <p className="mt-3 text-[13px] text-zinc-400">Loading profiles...</p>
          </div>
        ) : profiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100">
              <svg className="h-6 w-6 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15A2.25 2.25 0 002.25 6.75v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
              </svg>
            </div>
            <p className="text-[13px] font-medium text-zinc-600">No buyer profiles yet</p>
            <p className="mt-1 text-[12px] text-zinc-400">Create a profile to define who you are selling to</p>
            <button
              onClick={openCreate}
              className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
            >
              Create your first profile
            </button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {profiles.map((profile) => (
              <ProfileCard
                key={profile._id}
                profile={profile}
                onEdit={() => openEdit(profile)}
                onDelete={() => handleDelete(profile._id)}
                onSetDefault={() => handleSetDefault(profile._id)}
              />
            ))}
          </div>
        )}
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
