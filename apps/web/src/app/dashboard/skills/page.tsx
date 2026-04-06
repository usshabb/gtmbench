"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DATA_CHANGED_EVENT, safeJson, apiFetch } from "../components";

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
    name: "detect-ats",
    description: "Identify the applicant tracking system (ATS) used by each company. Runs automatically when a company is added to detect hiring tools like Greenhouse, Lever, Workday, and more.",
    appliesTo: "Companies",
  },
];

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

function SkillCard({
  skill,
  enabled,
  isToggling,
  onToggle,
}: {
  skill: (typeof AVAILABLE_SKILLS)[number];
  enabled: boolean;
  isToggling: boolean;
  onToggle: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="group relative flex flex-col rounded-lg border border-[#e6e6e9] bg-white px-3.5 py-2.5 transition-all hover:border-[#d4d4d8]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-medium text-[#1b1b1f]">{skill.name}</h3>
            {enabled && (
              <span className="shrink-0 rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[10px] font-medium text-[#059669]">
                Enabled
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[#8b8d94] line-clamp-2">
            {skill.description}
          </p>
        </div>

        {/* 3-dot menu */}
        <div className="relative z-10 shrink-0">
          <button
            onClick={() => setShowMenu((v) => !v)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-[#8b8d94] transition-all hover:bg-[#f5f5f7] hover:text-[#6b6f76]"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-8 z-30 w-40 rounded-md border border-[#e6e6e9] bg-white py-1 shadow-lg">
                <button
                  onClick={() => { setShowMenu(false); onToggle(); }}
                  disabled={isToggling}
                  className="flex w-full items-center px-3 py-2 text-[13px] text-[#6b6f76] hover:bg-[#f9f9fb] transition-colors disabled:opacity-50"
                >
                  {enabled ? "Disable" : "Enable"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Applies to */}
      <div className="mt-3 flex items-center gap-2">
        <span className="rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[11px] font-medium text-[#6b6f76]">
          {skill.appliesTo}
        </span>
      </div>
    </div>
  );
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
    void apiFetch(`${apiBaseUrl}/skills`, { headers: { Authorization: `Bearer ${authToken}` } })
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
        const res = await apiFetch(`${apiBaseUrl}/skills/${existing._id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ enabled: !existing.enabled }),
        });
        if (!res.ok) throw new Error("Could not update skill");
        const data = (await safeJson(res)) as { skill: SkillRecord };
        setSkills((prev) => prev.map((s) => (s._id === data.skill._id ? data.skill : s)));
      } else {
        const res = await apiFetch(`${apiBaseUrl}/skills`, {
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
    <div className="flex h-full flex-col bg-white">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {/* Header */}
          <p className="text-[13px] text-[#6b6f76] leading-relaxed">
            Extend what sidr can do with reusable skills. Skills run automatically on your records when enabled.
          </p>

          {/* Filter tabs + Create */}
          <div className="mt-4 flex items-center justify-between">
            <div className="inline-flex border-b border-[#e6e6e9]">
              {["All", "Enabled", "Disabled"].map((tab) => (
                <button
                  key={tab}
                  className="text-[#1b1b1f] border-b-2 border-[#1b1b1f] px-3 py-2 text-[13px] font-medium transition-colors"
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {/* Skills grid */}
          <div className="mt-5">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {AVAILABLE_SKILLS.map((skill) => {
                  const enabled = isSkillEnabled(skill.type);
                  const isToggling = togglingSkill === skill.type;

                  return (
                    <SkillCard
                      key={skill.type}
                      skill={skill}
                      enabled={enabled}
                      isToggling={isToggling}
                      onToggle={() => handleToggleSkill(skill.type)}
                    />
                  );
                })}
              </div>
            )}

            {!isLoading && AVAILABLE_SKILLS.length === 0 && (
              <div className="flex items-center justify-center py-16">
                <p className="text-[14px] text-[#8b8d94]">No skills available yet</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
