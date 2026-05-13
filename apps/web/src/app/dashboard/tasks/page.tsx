"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, LetterAvatar, safeJson } from "../components";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

type TaskStatus = "open" | "completed";

interface Task {
  _id: string;
  title: string;
  description?: string | null;
  assigneeEmail: string;
  createdByEmail: string;
  status: TaskStatus;
  dueDate?: string | null;
  completedAt?: string | null;
  companyId?: string | null;
  personId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Member {
  email: string;
  fullName?: string | null;
  profilePhotoUrl?: string | null;
}

interface Company {
  _id: string;
  domain: string;
  enrichmentData?: unknown;
}

interface Person {
  _id: string;
  linkedinUrl: string;
  workEmail?: string;
  enrichmentData?: unknown;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                              */
/* ------------------------------------------------------------------ */

function shortDate(dueDate: string | null | undefined): { label: string; tone: "neutral" | "warn" | "overdue" } | null {
  if (!dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  const label = due.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (diffDays < 0) return { label, tone: "overdue" };
  if (diffDays <= 1) return { label, tone: "warn" };
  return { label, tone: "neutral" };
}

function memberName(member: Member | undefined, fallbackEmail: string): string {
  return member?.fullName?.trim() || fallbackEmail.split("@")[0];
}

function companyName(company: Company): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (company.enrichmentData as any)?.output?.data?.[0];
  return data?.preferred_name ?? data?.name ?? data?.company_name ?? company.domain;
}

function personName(person: Person): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (person.enrichmentData as any)?.output?.data?.[0];
  if (data) {
    const explicit = data.name as string | undefined;
    if (explicit?.trim()) return explicit.trim();
    const composed = [data.first_name, data.last_name].filter(Boolean).join(" ").trim();
    if (composed) return composed;
  }
  const slug = person.linkedinUrl.split("/in/")[1]?.replace(/\/+$/, "")?.split("?")[0];
  if (slug) return slug.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
  return person.linkedinUrl;
}

/* ------------------------------------------------------------------ */
/*  Combobox                                                            */
/* ------------------------------------------------------------------ */

interface ComboItem {
  id: string;
  label: string;
  sublabel?: string;
}

function ChipPicker({
  value,
  items,
  placeholder,
  selectedLabel,
  selectedIcon,
  onChange,
  variant = "linked",
}: {
  value: string | null;
  items: ComboItem[];
  placeholder: string;
  selectedLabel?: string;
  selectedIcon?: React.ReactNode;
  onChange: (id: string | null) => void;
  variant?: "linked" | "unset-faint";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    return items
      .filter((i) => i.label.toLowerCase().includes(q) || (i.sublabel?.toLowerCase().includes(q) ?? false))
      .slice(0, 50);
  }, [items, query]);

  const baseStyle = value
    ? "border border-[#e6e6e9] bg-white text-[#3b3d44] hover:border-[#d4d4d8]"
    : variant === "unset-faint"
      ? "border border-transparent text-[#b4b5ba] hover:border-[#e6e6e9] hover:text-[#8b8d94]"
      : "border border-[#e6e6e9] bg-white text-[#8b8d94] hover:border-[#d4d4d8]";

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-[3px] text-[11px] font-medium transition-colors ${baseStyle}`}
      >
        <span className="opacity-80">{selectedIcon}</span>
        <span className="max-w-[120px] truncate">{value ? (selectedLabel ?? placeholder) : placeholder}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-64 rounded-lg border border-[#e6e6e9] bg-white shadow-lg">
          <div className="border-b border-[#f1f1f3] p-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${placeholder.toLowerCase()}…`}
              autoFocus
              className="w-full rounded-md border border-[#e6e6e9] bg-white px-2 py-1.5 text-[12px] placeholder:text-[#b4b5ba] focus:border-[#5e6ad2] focus:outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {value && (
              <button
                type="button"
                onClick={() => { onChange(null); setOpen(false); setQuery(""); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[#8b8d94] hover:bg-[#f9f9fb]"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Clear
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-center text-[12px] text-[#8b8d94]">No matches</p>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { onChange(item.id); setOpen(false); setQuery(""); }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[#f9f9fb] ${
                    item.id === value ? "bg-[#f5f5f7]" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-[#1b1b1f]">{item.label}</p>
                    {item.sublabel && <p className="truncate text-[11px] text-[#8b8d94]">{item.sublabel}</p>}
                  </div>
                  {item.id === value && (
                    <svg className="h-3 w-3 shrink-0 text-[#5e6ad2]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Assignee picker (avatar dropdown)                                    */
/* ------------------------------------------------------------------ */

function AssigneePicker({
  value,
  members,
  currentEmail,
  onChange,
}: {
  value: string;
  members: Member[];
  currentEmail: string;
  onChange: (email: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const memberByEmail = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of members) map.set(m.email.toLowerCase(), m);
    return map;
  }, [members]);

  const selectedMember = memberByEmail.get(value.toLowerCase());
  const displayName = memberName(selectedMember, value);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="block transition-opacity hover:opacity-80"
        title={displayName}
      >
        <LetterAvatar name={displayName || "?"} src={selectedMember?.profilePhotoUrl ?? null} size="xs" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-56 rounded-lg border border-[#e6e6e9] bg-white shadow-lg py-1">
          {members.map((m) => (
            <button
              key={m.email}
              type="button"
              onClick={() => { onChange(m.email); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[#f9f9fb] ${
                m.email === value ? "bg-[#f5f5f7]" : ""
              }`}
            >
              <LetterAvatar name={memberName(m, m.email)} src={m.profilePhotoUrl ?? null} size="xs" />
              <span className="flex-1 truncate text-[12px] text-[#1b1b1f]">
                {memberName(m, m.email)}{m.email === currentEmail ? " (you)" : ""}
              </span>
              {m.email === value && (
                <svg className="h-3 w-3 shrink-0 text-[#5e6ad2]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Icons                                                               */
/* ------------------------------------------------------------------ */

const buildingIcon = (
  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6h4M10 10h4M10 14h4M10 18h4" />
  </svg>
);

const personIcon = (
  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <circle cx="12" cy="8" r="4" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

const dateIcon = (
  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Inline add row                                                       */
/* ------------------------------------------------------------------ */

function InlineAddRow({
  members,
  companies,
  persons,
  currentEmail,
  onCancel,
  onSubmit,
  companyOptions,
  personOptions,
}: {
  members: Member[];
  companies: Company[];
  persons: Person[];
  currentEmail: string;
  onCancel: () => void;
  onSubmit: (data: { title: string; assigneeEmail: string; dueDate: string | null; companyId: string | null; personId: string | null }) => Promise<void>;
  companyOptions: ComboItem[];
  personOptions: ComboItem[];
}) {
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState(currentEmail);
  const [dueDate, setDueDate] = useState("");
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function commit() {
    if (!title.trim() || saving) return;
    setSaving(true);
    await onSubmit({
      title: title.trim(),
      assigneeEmail: assignee || currentEmail,
      dueDate: dueDate || null,
      companyId,
      personId,
    });
    setTitle("");
    setDueDate("");
    setCompanyId(null);
    setPersonId(null);
    setSaving(false);
    inputRef.current?.focus();
  }

  return (
    <div className="flex items-center gap-2 border-y border-[#5e6ad2]/20 bg-[#fafbff] pl-7 pr-2 py-1.5">
      <span className="block h-3.5 w-3.5 rounded-full border-[1.5px] border-dashed border-[#c4c7d1]" />
      <input
        ref={inputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); void commit(); }
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Task title"
        disabled={saving}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-[#1b1b1f] placeholder:text-[#b4b5ba] outline-none disabled:opacity-50"
      />
      <ChipPicker
        value={companyId}
        items={companyOptions}
        placeholder="Company"
        selectedLabel={companyId ? companies.find((c) => c._id === companyId) && companyName(companies.find((c) => c._id === companyId)!) : undefined}
        selectedIcon={buildingIcon}
        onChange={setCompanyId}
      />
      <ChipPicker
        value={personId}
        items={personOptions}
        placeholder="Person"
        selectedLabel={personId ? persons.find((p) => p._id === personId) && personName(persons.find((p) => p._id === personId)!) : undefined}
        selectedIcon={personIcon}
        onChange={setPersonId}
      />
      <label className="relative inline-flex items-center gap-1 rounded-md border border-[#e6e6e9] bg-white px-1.5 py-[3px] text-[11px] font-medium text-[#3b3d44] cursor-pointer">
        <span className="opacity-80">{dateIcon}</span>
        <span>{dueDate ? new Date(dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Date"}</span>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </label>
      <AssigneePicker value={assignee} members={members} currentEmail={currentEmail} onChange={setAssignee} />
      <button
        type="button"
        onClick={() => void commit()}
        disabled={!title.trim() || saving}
        className="rounded-md bg-[#1b1b1f] px-2.5 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {saving ? "…" : "Add"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded p-1 text-[#8b8d94] hover:bg-[#f5f5f7] hover:text-[#6b6f76]"
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function TasksPage() {
  const apiBaseUrl = getApiBaseUrl();
  const [token, setToken] = useState("");
  const [currentEmail, setCurrentEmail] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);

  const [openExpanded, setOpenExpanded] = useState(true);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [adding, setAdding] = useState(false);

  // Inline title edit
  const [editing, setEditing] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const memberByEmail = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of members) map.set(m.email.toLowerCase(), m);
    return map;
  }, [members]);

  const companyById = useMemo(() => {
    const map = new Map<string, Company>();
    for (const c of companies) map.set(c._id, c);
    return map;
  }, [companies]);

  const personById = useMemo(() => {
    const map = new Map<string, Person>();
    for (const p of persons) map.set(p._id, p);
    return map;
  }, [persons]);

  const companyOptions: ComboItem[] = useMemo(
    () => companies.map((c) => ({ id: c._id, label: companyName(c), sublabel: c.domain })),
    [companies],
  );

  const personOptions: ComboItem[] = useMemo(
    () => persons.map((p) => ({ id: p._id, label: personName(p), sublabel: p.workEmail || p.linkedinUrl.replace(/^https?:\/\/(www\.)?/, "") })),
    [persons],
  );

  const fetchAll = useCallback(async (authToken: string) => {
    setLoading(true);
    try {
      const auth = { headers: { Authorization: `Bearer ${authToken}` } };
      const [tasksRes, membersRes, meRes, companiesRes, personsRes] = await Promise.all([
        apiFetch(`${apiBaseUrl}/tasks`, auth),
        apiFetch(`${apiBaseUrl}/workspace/members`, auth),
        apiFetch(`${apiBaseUrl}/me`, auth),
        apiFetch(`${apiBaseUrl}/companies`, auth),
        apiFetch(`${apiBaseUrl}/persons`, auth),
      ]);
      const tasksData = (await safeJson(tasksRes)) as { tasks?: Task[] };
      const membersData = (await safeJson(membersRes)) as { members?: Member[] };
      const meData = (await safeJson(meRes)) as { email?: string };
      const companiesData = (await safeJson(companiesRes)) as { companies?: Company[] };
      const personsData = (await safeJson(personsRes)) as { persons?: Person[] };

      setTasks(tasksData.tasks ?? []);
      setMembers(membersData.members ?? []);
      setCurrentEmail((meData.email ?? "").toLowerCase());
      setCompanies(companiesData.companies ?? []);
      setPersons(personsData.persons ?? []);
    } catch (err) {
      console.error("[tasks] fetch failed", err);
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    const t = window.localStorage.getItem(localStorageTokenKey) ?? "";
    setToken(t);
    if (t) void fetchAll(t);
  }, [fetchAll]);

  async function createTask(data: { title: string; assigneeEmail: string; dueDate: string | null; companyId: string | null; personId: string | null }) {
    console.log(`[tasks] POST /tasks`, data);
    const res = await apiFetch(`${apiBaseUrl}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    });
    const body = (await safeJson(res)) as { task?: Task };
    if (body.task) setTasks((prev) => [body.task!, ...prev]);
    window.dispatchEvent(new CustomEvent("gtmbench:tasks-updated"));
  }

  async function patchTask(taskId: string, patch: Partial<Task>) {
    return apiFetch(`${apiBaseUrl}/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(patch),
    });
  }

  async function toggleStatus(task: Task) {
    const nextStatus: TaskStatus = task.status === "open" ? "completed" : "open";
    setTasks((prev) => prev.map((t) => (t._id === task._id ? { ...t, status: nextStatus } : t)));
    try {
      const res = await patchTask(task._id, { status: nextStatus });
      const data = (await safeJson(res)) as { task?: Task };
      if (data.task) setTasks((prev) => prev.map((t) => (t._id === task._id ? data.task! : t)));
      window.dispatchEvent(new CustomEvent("gtmbench:tasks-updated"));
    } catch {
      setTasks((prev) => prev.map((t) => (t._id === task._id ? { ...t, status: task.status } : t)));
    }
  }

  async function changeAssignee(task: Task, email: string) {
    if (email === task.assigneeEmail) return;
    setTasks((prev) => prev.map((t) => (t._id === task._id ? { ...t, assigneeEmail: email } : t)));
    try { await patchTask(task._id, { assigneeEmail: email }); }
    catch { setTasks((prev) => prev.map((t) => (t._id === task._id ? { ...t, assigneeEmail: task.assigneeEmail } : t))); }
  }

  async function changeDueDate(task: Task, due: string) {
    const value = due || null;
    setTasks((prev) => prev.map((t) => (t._id === task._id ? { ...t, dueDate: value } : t)));
    try { await patchTask(task._id, { dueDate: value }); }
    catch { setTasks((prev) => prev.map((t) => (t._id === task._id ? { ...t, dueDate: task.dueDate ?? null } : t))); }
  }

  async function changeTag(task: Task, field: "companyId" | "personId", id: string | null) {
    setTasks((prev) => prev.map((t) => (t._id === task._id ? { ...t, [field]: id } : t)));
    try { await patchTask(task._id, { [field]: id }); }
    catch { setTasks((prev) => prev.map((t) => (t._id === task._id ? { ...t, [field]: task[field] ?? null } : t))); }
  }

  async function saveTitle(task: Task) {
    if (!editTitle.trim() || editTitle.trim() === task.title) { setEditing(null); return; }
    try {
      const res = await patchTask(task._id, { title: editTitle.trim() });
      const data = (await safeJson(res)) as { task?: Task };
      if (data.task) setTasks((prev) => prev.map((t) => (t._id === task._id ? data.task! : t)));
    } finally { setEditing(null); }
  }

  async function deleteTask(task: Task) {
    if (!confirm(`Delete "${task.title}"?`)) return;
    setTasks((prev) => prev.filter((t) => t._id !== task._id));
    try {
      await apiFetch(`${apiBaseUrl}/tasks/${task._id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      window.dispatchEvent(new CustomEvent("gtmbench:tasks-updated"));
    } catch { void fetchAll(token); }
  }

  const openTasks = useMemo(() => tasks.filter((t) => t.status === "open"), [tasks]);
  const completedTasks = useMemo(() => tasks.filter((t) => t.status === "completed"), [tasks]);

  function renderRow(task: Task) {
    const assignee = memberByEmail.get(task.assigneeEmail.toLowerCase());
    const due = shortDate(task.dueDate);
    const isCompleted = task.status === "completed";
    const isEditing = editing === task._id;
    const company = task.companyId ? companyById.get(task.companyId) : null;
    const person = task.personId ? personById.get(task.personId) : null;

    return (
      <div
        key={task._id}
        className="group flex items-center gap-2 border-b border-[#f1f1f3] pl-3 pr-3 py-[7px] hover:bg-[#fafafb] transition-colors"
      >
        {/* Status circle */}
        <button
          onClick={() => toggleStatus(task)}
          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors ${
            isCompleted ? "border-[#5e6ad2] bg-[#5e6ad2] text-white" : "border-[#c4c7d1] hover:border-[#1b1b1f]"
          }`}
          title={isCompleted ? "Mark as open" : "Mark as completed"}
        >
          {isCompleted && (
            <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          )}
        </button>

        {/* Title */}
        {isEditing ? (
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={() => void saveTitle(task)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveTitle(task);
              if (e.key === "Escape") setEditing(null);
            }}
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[#1b1b1f] outline-none"
          />
        ) : (
          <button
            onClick={() => { setEditing(task._id); setEditTitle(task.title); }}
            className={`min-w-0 flex-1 truncate text-left text-[13px] ${isCompleted ? "text-[#a3a6ad] line-through" : "text-[#1b1b1f]"}`}
          >
            {task.title}
          </button>
        )}

        {/* Right side meta */}
        <div className="flex shrink-0 items-center gap-1.5">
          <ChipPicker
            value={task.companyId ?? null}
            items={companyOptions}
            placeholder="Company"
            selectedLabel={company ? companyName(company) : undefined}
            selectedIcon={buildingIcon}
            onChange={(id) => void changeTag(task, "companyId", id)}
            variant="unset-faint"
          />
          <ChipPicker
            value={task.personId ?? null}
            items={personOptions}
            placeholder="Person"
            selectedLabel={person ? personName(person) : undefined}
            selectedIcon={personIcon}
            onChange={(id) => void changeTag(task, "personId", id)}
            variant="unset-faint"
          />
          <label className={`relative inline-flex items-center gap-1 rounded-md px-1.5 py-[3px] text-[11px] font-medium cursor-pointer transition-colors ${
            due?.tone === "overdue" ? "bg-red-50 text-red-700"
            : due?.tone === "warn" ? "bg-amber-50 text-amber-700"
            : due ? "border border-[#e6e6e9] bg-white text-[#3b3d44]"
            : "border border-transparent text-[#b4b5ba] hover:border-[#e6e6e9] hover:text-[#8b8d94]"
          }`}>
            <span className="opacity-80">{dateIcon}</span>
            <span>{due?.label ?? "Date"}</span>
            <input
              type="date"
              value={task.dueDate ?? ""}
              onChange={(e) => void changeDueDate(task, e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </label>
          <AssigneePicker value={task.assigneeEmail} members={members} currentEmail={currentEmail} onChange={(e) => void changeAssignee(task, e)} />
          <button
            onClick={() => void deleteTask(task)}
            className="rounded p-1 text-[#b4b5ba] opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 hover:text-red-600"
            title="Delete"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-4 border-b border-[#f1f1f3]">
            <h1 className="text-[15px] font-semibold text-[#1b1b1f]">Tasks</h1>
          </div>

          {/* Open group */}
          <div>
            <div
              className="flex items-center gap-2 bg-[#fafafb] border-b border-[#f1f1f3] pl-2 pr-2 py-1.5 cursor-pointer select-none"
              onClick={() => setOpenExpanded((v) => !v)}
            >
              <svg
                className="h-3 w-3 text-[#8b8d94] transition-transform"
                style={{ transform: openExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border-[1.5px] border-[#c4c7d1]" />
              <span className="text-[12px] font-medium text-[#1b1b1f]">In progress</span>
              <span className="text-[11px] tabular-nums text-[#8b8d94]">{openTasks.length}</span>
              <div className="flex-1" />
              <button
                onClick={(e) => { e.stopPropagation(); setAdding(true); setOpenExpanded(true); }}
                className="flex h-5 w-5 items-center justify-center rounded text-[#8b8d94] hover:bg-[#ededf0] hover:text-[#1b1b1f]"
                title="Add task"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>

            {openExpanded && (
              <div>
                {adding && currentEmail && (
                  <InlineAddRow
                    members={members}
                    companies={companies}
                    persons={persons}
                    currentEmail={currentEmail}
                    onCancel={() => setAdding(false)}
                    onSubmit={createTask}
                    companyOptions={companyOptions}
                    personOptions={personOptions}
                  />
                )}
                {loading ? null : openTasks.length === 0 && !adding ? (
                  <div className="px-3 py-6 text-center">
                    <p className="text-[12px] text-[#8b8d94]">No open tasks. Click + to add one.</p>
                  </div>
                ) : (
                  openTasks.map(renderRow)
                )}
              </div>
            )}
          </div>

          {/* Completed group */}
          <div className="mt-1">
            <div
              className="flex items-center gap-2 bg-[#fafafb] border-b border-[#f1f1f3] pl-2 pr-2 py-1.5 cursor-pointer select-none"
              onClick={() => setCompletedExpanded((v) => !v)}
            >
              <svg
                className="h-3 w-3 text-[#8b8d94] transition-transform"
                style={{ transform: completedExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#5e6ad2] text-white">
                <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </span>
              <span className="text-[12px] font-medium text-[#1b1b1f]">Completed</span>
              <span className="text-[11px] tabular-nums text-[#8b8d94]">{completedTasks.length}</span>
            </div>
            {completedExpanded && (
              <div>
                {completedTasks.length === 0 ? (
                  <div className="px-3 py-6 text-center">
                    <p className="text-[12px] text-[#8b8d94]">No completed tasks yet.</p>
                  </div>
                ) : (
                  completedTasks.map(renderRow)
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
