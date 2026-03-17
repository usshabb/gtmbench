"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DATA_CHANGED_EVENT, safeJson } from "../components";

interface SkillRecord {
  _id: string;
  skillType: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const AVAILABLE_SKILLS = [
  {
    type: "detect_ats",
    name: "Detect ATS",
    description:
      "Detect the Applicant Tracking System used by a company. Identifies systems like Greenhouse, Lever, Ashby, and more by probing known URL patterns and using AI-powered web search.",
    appliesTo: "Companies",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
  },
];

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

export default function SkillsPage() {
  const router = useRouter();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const [authToken, setAuthToken] = useState("");
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [togglingSkill, setTogglingSkill] = useState<string | null>(null);

  useEffect(() => {
    const storedToken = window.localStorage.getItem(localStorageTokenKey);
    if (!storedToken) {
      router.replace("/");
      return;
    }
    setAuthToken(storedToken);
  }, [router]);

  const fetchSkills = useCallback(() => {
    if (!authToken) return;
    setIsLoading(true);
    void fetch(`${apiBaseUrl}/skills`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(async (res) => {
        const data = (await safeJson(res)) as { skills?: SkillRecord[] };
        setSkills(data.skills ?? []);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [apiBaseUrl, authToken]);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  useEffect(() => {
    const handler = () => fetchSkills();
    window.addEventListener(DATA_CHANGED_EVENT, handler);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, handler);
  }, [fetchSkills]);

  async function handleToggleSkill(skillType: string) {
    setTogglingSkill(skillType);
    try {
      const existing = skills.find((s) => s.skillType === skillType);

      if (existing) {
        // Toggle via PUT
        const res = await fetch(`${apiBaseUrl}/skills/${existing._id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ enabled: !existing.enabled }),
        });
        if (!res.ok) throw new Error("Could not update skill");
        const data = (await safeJson(res)) as { skill: SkillRecord };
        setSkills((prev) =>
          prev.map((s) => (s._id === data.skill._id ? data.skill : s)),
        );
      } else {
        // Enable via POST
        const res = await fetch(`${apiBaseUrl}/skills`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ skillType }),
        });
        if (!res.ok) throw new Error("Could not enable skill");
        const data = (await safeJson(res)) as { skill: SkillRecord };
        setSkills((prev) => [...prev, data.skill]);
      }
    } catch {
      // silent
    } finally {
      setTogglingSkill(null);
    }
  }

  function isSkillEnabled(skillType: string): boolean {
    return skills.some((s) => s.skillType === skillType && s.enabled);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Page header */}
      <div className="border-b border-zinc-200 px-6 py-4">
        <h1 className="text-lg font-semibold text-zinc-900">Skills</h1>
        <p className="mt-0.5 text-[13px] text-zinc-500">
          Enable skills to unlock one-time actions you can run on companies and people. Skills are different from triggers &mdash; they run once when you invoke them, rather than tracking activity daily.
        </p>
      </div>

      {/* Skills list */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
            <p className="mt-3 text-[13px] text-zinc-400">Loading skills...</p>
          </div>
        ) : (
          <div className="space-y-4">
            {AVAILABLE_SKILLS.map((skill) => {
              const enabled = isSkillEnabled(skill.type);
              const isToggling = togglingSkill === skill.type;

              return (
                <div
                  key={skill.type}
                  className={`rounded-xl border px-5 py-5 transition-colors ${
                    enabled
                      ? "border-zinc-200 bg-white"
                      : "border-zinc-100 bg-zinc-50/50"
                  }`}
                >
                  <div className="flex items-start gap-4">
                    {/* Icon */}
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                        enabled
                          ? "bg-zinc-900 text-white"
                          : "bg-zinc-100 text-zinc-400"
                      }`}
                    >
                      {skill.icon}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-[15px] font-semibold text-zinc-900">
                          {skill.name}
                        </h3>
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                          {skill.appliesTo}
                        </span>
                        {enabled && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            Enabled
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
                        {skill.description}
                      </p>
                    </div>

                    {/* Toggle */}
                    <button
                      onClick={() => handleToggleSkill(skill.type)}
                      disabled={isToggling}
                      className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-60 ${
                        enabled ? "bg-zinc-900" : "bg-zinc-200"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 rounded-full bg-white transition-transform shadow-sm ${
                          enabled ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>

                  {enabled && (
                    <div className="mt-4 rounded-lg bg-zinc-50 px-4 py-3">
                      <p className="text-[12px] text-zinc-500">
                        This skill is now available in the <strong>3-dot menu</strong> on each company. Navigate to a company and click the menu to run it.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
