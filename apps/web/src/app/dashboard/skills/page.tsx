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
    tagline: "Identify the hiring system used by each company",
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
    if (!storedToken) { router.replace("/"); return; }
    setAuthToken(storedToken);
  }, [router]);

  const fetchSkills = useCallback(() => {
    if (!authToken) return;
    setIsLoading(true);
    void fetch(`${apiBaseUrl}/skills`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async (res) => {
        const data = (await safeJson(res)) as { skills?: SkillRecord[] };
        setSkills(data.skills ?? []);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [apiBaseUrl, authToken]);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

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
        const res = await fetch(`${apiBaseUrl}/skills/${existing._id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ enabled: !existing.enabled }),
        });
        if (!res.ok) throw new Error("Could not update skill");
        const data = (await safeJson(res)) as { skill: SkillRecord };
        setSkills((prev) => prev.map((s) => (s._id === data.skill._id ? data.skill : s)));
      } else {
        const res = await fetch(`${apiBaseUrl}/skills`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ skillType }),
        });
        if (!res.ok) throw new Error("Could not enable skill");
        const data = (await safeJson(res)) as { skill: SkillRecord };
        setSkills((prev) => [...prev, data.skill]);
      }
    } catch { /* silent */ } finally { setTogglingSkill(null); }
  }

  function isSkillEnabled(skillType: string): boolean {
    return skills.some((s) => s.skillType === skillType && s.enabled);
  }

  return (
    <div className="flex h-full flex-col bg-[#f8f8f7]">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[800px] px-4 py-6">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {AVAILABLE_SKILLS.map((skill) => {
              const enabled = isSkillEnabled(skill.type);
              const isToggling = togglingSkill === skill.type;

              return (
                <div
                  key={skill.type}
                  className={`group flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition-all hover:shadow-md ${enabled ? "border-zinc-300" : "border-zinc-200"}`}
                >
                  {/* Icon area */}
                  <div className="relative flex h-28 items-end bg-cover bg-center px-4 pb-4" style={{ backgroundImage: "url('/card-header.webp')" }}>
                    <div className="absolute inset-0 rounded-t-2xl bg-black/30" />
                    <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-white backdrop-blur-sm border border-white/20">
                      {skill.icon}
                    </div>
                    {enabled && (
                      <span className="absolute top-3 right-3 rounded-full bg-emerald-400/25 px-2 py-0.5 text-[10px] font-medium text-emerald-200 border border-emerald-400/30 backdrop-blur-sm">
                        Enabled
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex flex-1 flex-col px-4 pt-3 pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-[14px] font-bold text-zinc-900">{skill.name}</h3>
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">{skill.appliesTo}</span>
                        </div>
                        <p className="mt-0.5 text-[12px] text-zinc-400">{skill.tagline}</p>
                      </div>

                      {/* Toggle */}
                      <button
                        onClick={() => handleToggleSkill(skill.type)}
                        disabled={isToggling}
                        className={`shrink-0 relative mt-0.5 inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-60 ${enabled ? "bg-zinc-900" : "bg-zinc-200"}`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform shadow-sm ${enabled ? "translate-x-[18px]" : "translate-x-[3px]"}`} />
                      </button>
                    </div>

                    {enabled && (
                      <p className="mt-3 text-[11px] text-zinc-400">
                        Available in the <span className="font-medium text-zinc-600">⋯ menu</span> on each company.
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
    </div>
  );
}
