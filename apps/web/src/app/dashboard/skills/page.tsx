"use client";

import { useEffect, useState } from "react";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

interface Skill {
  _id: string;
  skillType: string;
  config: { keyword?: string | null };
  status: "active" | "paused";
  createdAt: string;
  updatedAt: string;
}

const SKILL_DEFINITIONS = [
  {
    type: "linkedin_content",
    name: "LinkedIn Content",
    description:
      "Track LinkedIn posts from people in your list. When a new post is detected (< 24h old), it becomes a signal. Optionally filter by keyword.",
    icon: (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
];

export default function SkillsPage() {
  const apiBaseUrl = getApiBaseUrl();
  const [token, setToken] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabling, setEnabling] = useState(false);
  const [keywordInput, setKeywordInput] = useState("");
  const [showKeywordModal, setShowKeywordModal] = useState<string | null>(null);
  const [triggerLoading, setTriggerLoading] = useState(false);

  useEffect(() => {
    const t = window.localStorage.getItem(localStorageTokenKey) ?? "";
    setToken(t);
    if (t) fetchSkills(t);
  }, []);

  async function fetchSkills(authToken: string) {
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/skills`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = (await res.json()) as { skills: Skill[] };
      setSkills(data.skills ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  function getSkillForType(type: string): Skill | undefined {
    return skills.find((s) => s.skillType === type);
  }

  async function enableSkill(type: string, keyword: string | null) {
    setEnabling(true);
    try {
      const res = await fetch(`${apiBaseUrl}/skills`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ skillType: type, keyword: keyword || null }),
      });
      if (res.ok) {
        await fetchSkills(token);
      }
    } finally {
      setEnabling(false);
      setShowKeywordModal(null);
      setKeywordInput("");
    }
  }

  async function toggleSkillStatus(skill: Skill) {
    const newStatus = skill.status === "active" ? "paused" : "active";
    await fetch(`${apiBaseUrl}/skills/${skill._id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: newStatus }),
    });
    await fetchSkills(token);
  }

  async function updateKeyword(skill: Skill, keyword: string | null) {
    await fetch(`${apiBaseUrl}/skills/${skill._id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ keyword }),
    });
    await fetchSkills(token);
  }

  async function disableSkill(skillId: string) {
    await fetch(`${apiBaseUrl}/skills/${skillId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    await fetchSkills(token);
  }

  async function triggerProcessing() {
    setTriggerLoading(true);
    try {
      await fetch(`${apiBaseUrl}/skills/trigger-processing`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } finally {
      setTriggerLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Page header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">Skills</h1>
          <p className="text-[13px] text-zinc-500">
            Enable skills to automatically track activity and generate signals
          </p>
        </div>
        <button
          onClick={triggerProcessing}
          disabled={triggerLoading}
          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50"
        >
          {triggerLoading ? "Processing..." : "Run Now"}
        </button>
      </div>

      {/* Skills list */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
          </div>
        ) : (
          <div className="space-y-4">
            {SKILL_DEFINITIONS.map((def) => {
              const skill = getSkillForType(def.type);
              const isEnabled = !!skill;

              return (
                <div
                  key={def.type}
                  className="rounded-xl border border-zinc-200 bg-white p-5"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      <div
                        className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                          isEnabled ? "bg-blue-50 text-blue-600" : "bg-zinc-100 text-zinc-400"
                        }`}
                      >
                        {def.icon}
                      </div>
                      <div>
                        <h3 className="text-[15px] font-semibold text-zinc-900">{def.name}</h3>
                        <p className="mt-0.5 max-w-md text-[13px] text-zinc-500">{def.description}</p>

                        {skill && (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                skill.status === "active"
                                  ? "bg-green-50 text-green-700"
                                  : "bg-yellow-50 text-yellow-700"
                              }`}
                            >
                              {skill.status === "active" ? "Active" : "Paused"}
                            </span>
                            {skill.config.keyword && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                                Keyword: &quot;{skill.config.keyword}&quot;
                                <button
                                  onClick={() => updateKeyword(skill, null)}
                                  className="ml-0.5 text-zinc-400 hover:text-zinc-600"
                                >
                                  &times;
                                </button>
                              </span>
                            )}
                            {!skill.config.keyword && (
                              <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500">
                                All posts tracked
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isEnabled ? (
                        <>
                          <button
                            onClick={() => toggleSkillStatus(skill!)}
                            className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                              skill!.status === "active"
                                ? "border-yellow-200 text-yellow-700 hover:bg-yellow-50"
                                : "border-green-200 text-green-700 hover:bg-green-50"
                            }`}
                          >
                            {skill!.status === "active" ? "Pause" : "Resume"}
                          </button>
                          <button
                            onClick={() => {
                              setShowKeywordModal(skill!._id);
                              setKeywordInput(skill!.config.keyword ?? "");
                            }}
                            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
                          >
                            Edit Keyword
                          </button>
                          <button
                            onClick={() => disableSkill(skill!._id)}
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-50"
                          >
                            Disable
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setShowKeywordModal(def.type)}
                          disabled={enabling}
                          className="rounded-lg bg-zinc-900 px-4 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                        >
                          {enabling ? "Enabling..." : "Enable"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Keyword modal */}
      {showKeywordModal && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[20vh]"
          onClick={() => {
            setShowKeywordModal(null);
            setKeywordInput("");
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
              <h2 className="text-[15px] font-semibold text-zinc-900">
                {getSkillForType("linkedin_content") && showKeywordModal === getSkillForType("linkedin_content")?._id
                  ? "Update Keyword Filter"
                  : "Enable LinkedIn Content Tracking"}
              </h2>
              <button
                onClick={() => {
                  setShowKeywordModal(null);
                  setKeywordInput("");
                }}
                className="rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5">
              <label className="block text-[13px] font-medium text-zinc-700 mb-1.5">
                Keyword Filter (optional)
              </label>
              <input
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px] placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
                type="text"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                placeholder="e.g. hiring, funding, launch (leave empty for all posts)"
                autoFocus
              />
              <p className="mt-1.5 text-[12px] text-zinc-400">
                If set, only posts containing this keyword will appear as signals. Leave blank to track all posts.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowKeywordModal(null);
                    setKeywordInput("");
                  }}
                  className="rounded-lg border border-zinc-200 px-4 py-2 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    const existingSkill = getSkillForType("linkedin_content");
                    if (existingSkill && showKeywordModal === existingSkill._id) {
                      await updateKeyword(existingSkill, keywordInput || null);
                      setShowKeywordModal(null);
                      setKeywordInput("");
                    } else {
                      await enableSkill("linkedin_content", keywordInput || null);
                    }
                  }}
                  disabled={enabling}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {enabling ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
