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

function relativeDue(dueDate: string | null | undefined): { label: string; tone: "neutral" | "warn" | "overdue" } | null {
  if (!dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) return { label: `${Math.abs(diffDays)}d overdue`, tone: "overdue" };
  if (diffDays === 0) return { label: "Due today", tone: "warn" };
  if (diffDays === 1) return { label: "Due tomorrow", tone: "warn" };
  if (diffDays < 7) return { label: `Due in ${diffDays}d`, tone: "neutral" };
  return { label: due.toLocaleDateString("en-US", { month: "short", day: "numeric" }), tone: "neutral" };
}

function displayName(member: Member | undefined, fallbackEmail: string): string {
  return member?.fullName?.trim() || fallbackEmail.split("@")[0];
}

function companyDisplayName(company: Company): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (company.enrichmentData as any)?.output?.data?.[0];
  return data?.preferred_name ?? data?.name ?? data?.company_name ?? company.domain;
}

function personDisplayName(person: Person): string {
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
/*  Searchable combobox picker                                          */
/* ------------------------------------------------------------------ */

interface ComboItem {
  id: string;
  label: string;
  sublabel?: string;
}

function ComboPicker({
  value,
  items,
  placeholder,
  emptyLabel,
  selectedLabel,
  selectedIcon,
  onChange,
  disabled,
}: {
  value: string | null;
  items: ComboItem[];
  placeholder: string;
  emptyLabel: string;
  selectedLabel?: string;
  selectedIcon?: React.ReactNode;
  onChange: (id: string | null) => void;
  disabled?: boolean;
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

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
          value
            ? "bg-[#eef0ff] text-[#5e6ad2] hover:bg-[#e0e4ff]"
            : "bg-[#f5f5f7] text-[#6b6f76] hover:bg-[#ededf0]"
        } disabled:opacity-50`}
      >
        {selectedIcon}
        <span className="max-w-[140px] truncate">{value ? (selectedLabel ?? placeholder) : placeholder}</span>
        {value && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(null); setQuery(""); }}
            className="ml-0.5 -mr-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-current opacity-60 hover:opacity-100"
            title="Clear"
          >
            <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-64 rounded-lg border border-[#e6e6e9] bg-white shadow-lg">
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
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-center text-[12px] text-[#8b8d94]">{emptyLabel}</p>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { onChange(item.id); setOpen(false); setQuery(""); }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-[#f9f9fb] ${
                    item.id === value ? "bg-[#f5f5f7]" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-[#1b1b1f]">{item.label}</p>
                    {item.sublabel && (
                      <p className="truncate text-[11px] text-[#8b8d94]">{item.sublabel}</p>
                    )}
                  </div>
                  {item.id === value && (
                    <svg className="h-3.5 w-3.5 shrink-0 text-[#5e6ad2]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
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
  const [filter, setFilter] = useState<"all" | "open" | "mine" | "completed">("open");

  // New task form
  const [newTitle, setNewTitle] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newCompanyId, setNewCompanyId] = useState<string | null>(null);
  const [newPersonId, setNewPersonId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Inline edit state
  const [editing, setEditing] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

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
    () => companies.map((c) => ({
      id: c._id,
      label: companyDisplayName(c),
      sublabel: c.domain,
    })),
    [companies],
  );

  const personOptions: ComboItem[] = useMemo(
    () => persons.map((p) => ({
      id: p._id,
      label: personDisplayName(p),
      sublabel: p.workEmail || p.linkedinUrl.replace(/^https?:\/\/(www\.)?/, ""),
    })),
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
      console.log(`[tasks] loaded ${tasksData.tasks?.length ?? 0} task(s), ${membersData.members?.length ?? 0} member(s), ${companiesData.companies?.length ?? 0} company(s), ${personsData.persons?.length ?? 0} person(s)`);
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

  useEffect(() => {
    if (!newAssignee && currentEmail) setNewAssignee(currentEmail);
  }, [currentEmail, newAssignee]);

  async function createTask(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!newTitle.trim() || !newAssignee) return;
    setCreating(true);
    setCreateError("");
    console.log(`[tasks] POST /tasks title="${newTitle.trim()}" assignee=${newAssignee} company=${newCompanyId ?? "-"} person=${newPersonId ?? "-"}`);
    try {
      const res = await apiFetch(`${apiBaseUrl}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: newTitle.trim(),
          description: newDescription.trim() || null,
          assigneeEmail: newAssignee,
          dueDate: newDueDate || null,
          companyId: newCompanyId,
          personId: newPersonId,
        }),
      });
      const data = (await safeJson(res)) as { task?: Task; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not create task");
      if (data.task) setTasks((prev) => [data.task!, ...prev]);
      setNewTitle("");
      setNewDescription("");
      setNewDueDate("");
      setNewCompanyId(null);
      setNewPersonId(null);
      window.dispatchEvent(new CustomEvent("gtmbench:tasks-updated"));
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create task");
    } finally {
      setCreating(false);
    }
  }

  async function patchTask(taskId: string, patch: Partial<Task>) {
    console.log(`[tasks] PUT /tasks/${taskId}`, patch);
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
    } catch (err) {
      console.error("[tasks] toggle failed, reverting", err);
      setTasks((prev) => prev.map((t) => (t._id === task._id ? { ...t, status: task.status } : t)));
    }
  }

  async function changeAssignee(task: Task, newAssigneeEmail: string) {
    if (newAssigneeEmail === task.assigneeEmail) return;
    setTasks((prev) => prev.map((t) => (t._id === task._id ? { ...t, assigneeEmail: newAssigneeEmail } : t)));
    try {
      await patchTask(task._id, { assigneeEmail: newAssigneeEmail });
    } catch {
      setTasks((prev) => prev.map((t) => (t._id === task._id ? { ...t, assigneeEmail: task.assigneeEmail } : t)));
    }
  }

  async function changeDueDate(task: Task, newDue: string) {
    const value = newDue || null;
    setTasks((prev) => prev.map((t) => (t._id === task._id ? { ...t, dueDate: value } : t)));
    try {
      await patchTask(task._id, { dueDate: value });
    } catch {
      setTasks((prev) => prev.map((t) => (t._id === task._id ? { ...t, dueDate: task.dueDate ?? null } : t)));
    }
  }

  async function changeTag(task: Task, field: "companyId" | "personId", id: string | null) {
    setTasks((prev) => prev.map((t) => (t._id === task._id ? { ...t, [field]: id } : t)));
    try {
      await patchTask(task._id, { [field]: id });
    } catch {
      setTasks((prev) => prev.map((t) => (t._id === task._id ? { ...t, [field]: task[field] ?? null } : t)));
    }
  }

  async function saveTitleEdit(task: Task) {
    if (!editTitle.trim() || editTitle.trim() === task.title) {
      setEditing(null);
      return;
    }
    setSavingEdit(true);
    try {
      const res = await patchTask(task._id, { title: editTitle.trim() });
      const data = (await safeJson(res)) as { task?: Task };
      if (data.task) setTasks((prev) => prev.map((t) => (t._id === task._id ? data.task! : t)));
    } finally {
      setSavingEdit(false);
      setEditing(null);
    }
  }

  async function deleteTask(task: Task) {
    if (!confirm(`Delete "${task.title}"?`)) return;
    console.log(`[tasks] DELETE /tasks/${task._id}`);
    setTasks((prev) => prev.filter((t) => t._id !== task._id));
    try {
      await apiFetch(`${apiBaseUrl}/tasks/${task._id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      window.dispatchEvent(new CustomEvent("gtmbench:tasks-updated"));
    } catch {
      void fetchAll(token);
    }
  }

  const visible = useMemo(() => {
    return tasks.filter((t) => {
      if (filter === "open") return t.status === "open";
      if (filter === "completed") return t.status === "completed";
      if (filter === "mine") return t.assigneeEmail === currentEmail && t.status === "open";
      return true;
    });
  }, [tasks, filter, currentEmail]);

  const counts = useMemo(() => ({
    all: tasks.length,
    open: tasks.filter((t) => t.status === "open").length,
    mine: tasks.filter((t) => t.assigneeEmail === currentEmail && t.status === "open").length,
    completed: tasks.filter((t) => t.status === "completed").length,
  }), [tasks, currentEmail]);

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

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          <div>
            <h1 className="text-[20px] font-semibold text-[#1b1b1f]">Tasks</h1>
            <p className="mt-0.5 text-[13px] text-[#6b6f76]">
              Create tasks, assign them to a workspace member, and tag any company or person.
            </p>
          </div>

          {/* New task form */}
          <form onSubmit={createTask} className="mt-5 rounded-lg border border-[#e6e6e9] bg-white p-3 space-y-2.5">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Add a task…"
              className="w-full bg-transparent text-[14px] text-[#1b1b1f] placeholder:text-[#b4b5ba] outline-none"
              autoFocus
            />
            {newTitle.trim().length > 0 && (
              <>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Add description (optional)…"
                  rows={2}
                  className="w-full bg-transparent text-[12px] text-[#3b3d44] placeholder:text-[#b4b5ba] outline-none resize-none border-t border-[#f1f1f3] pt-2"
                />
                <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Assignee */}
                    <label className="flex items-center gap-1.5 rounded-md bg-[#f5f5f7] px-2 py-1 text-[12px] text-[#3b3d44]">
                      <span className="text-[#8b8d94]">Assignee:</span>
                      <select
                        value={newAssignee}
                        onChange={(e) => setNewAssignee(e.target.value)}
                        className="bg-transparent text-[12px] font-medium text-[#1b1b1f] outline-none"
                      >
                        {members.map((m) => (
                          <option key={m.email} value={m.email}>
                            {displayName(m, m.email)}{m.email === currentEmail ? " (you)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    {/* Due date */}
                    <label className="flex items-center gap-1.5 rounded-md bg-[#f5f5f7] px-2 py-1 text-[12px] text-[#3b3d44]">
                      <span className="text-[#8b8d94]">Due:</span>
                      <input
                        type="date"
                        value={newDueDate}
                        onChange={(e) => setNewDueDate(e.target.value)}
                        className="bg-transparent text-[12px] text-[#1b1b1f] outline-none"
                      />
                    </label>
                    {/* Company tag */}
                    <ComboPicker
                      value={newCompanyId}
                      items={companyOptions}
                      placeholder="Tag company"
                      emptyLabel={companies.length === 0 ? "No companies in workspace yet" : "No matches"}
                      selectedLabel={newCompanyId ? (companyById.get(newCompanyId) ? companyDisplayName(companyById.get(newCompanyId)!) : undefined) : undefined}
                      selectedIcon={buildingIcon}
                      onChange={setNewCompanyId}
                    />
                    {/* Person tag */}
                    <ComboPicker
                      value={newPersonId}
                      items={personOptions}
                      placeholder="Tag person"
                      emptyLabel={persons.length === 0 ? "No people in workspace yet" : "No matches"}
                      selectedLabel={newPersonId ? (personById.get(newPersonId) ? personDisplayName(personById.get(newPersonId)!) : undefined) : undefined}
                      selectedIcon={personIcon}
                      onChange={setNewPersonId}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    {createError && <span className="text-[12px] text-red-600">{createError}</span>}
                    <button
                      type="submit"
                      disabled={creating || !newTitle.trim() || !newAssignee}
                      className="rounded-md bg-[#1b1b1f] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {creating ? "Adding…" : "Add task"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </form>

          {/* Filter tabs */}
          <div className="mt-5 inline-flex border-b border-[#e6e6e9]">
            {([
              { key: "open" as const, label: "Open", count: counts.open },
              { key: "mine" as const, label: "Assigned to me", count: counts.mine },
              { key: "all" as const, label: "All", count: counts.all },
              { key: "completed" as const, label: "Completed", count: counts.completed },
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
                  <span className="rounded-full bg-[#f5f5f7] px-1.5 py-0 text-[10px] font-medium tabular-nums text-[#8b8d94]">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* List */}
          <div className="mt-4">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
              </div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#e6e6e9] py-16 text-center">
                <svg className="h-8 w-8 text-[#d4d4d8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="mt-3 text-[14px] font-medium text-[#6b6f76]">
                  {filter === "completed" ? "No completed tasks yet" : "Nothing here"}
                </p>
                <p className="mt-1 text-[12px] text-[#8b8d94]">
                  {filter === "open" || filter === "mine" ? "Add one above to get started." : ""}
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-[#e6e6e9] bg-white divide-y divide-[#f1f1f3]">
                {visible.map((task) => {
                  const assignee = memberByEmail.get(task.assigneeEmail.toLowerCase());
                  const due = relativeDue(task.dueDate);
                  const isCompleted = task.status === "completed";
                  const isEditing = editing === task._id;
                  const company = task.companyId ? companyById.get(task.companyId) : null;
                  const person = task.personId ? personById.get(task.personId) : null;

                  return (
                    <div key={task._id} className="group flex items-start gap-3 px-4 py-3">
                      {/* Checkbox */}
                      <button
                        onClick={() => toggleStatus(task)}
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors ${
                          isCompleted
                            ? "border-[#1b1b1f] bg-[#1b1b1f] text-white"
                            : "border-[#d4d4d8] hover:border-[#1b1b1f]"
                        }`}
                        title={isCompleted ? "Mark as open" : "Mark as completed"}
                      >
                        {isCompleted && (
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        )}
                      </button>

                      {/* Main */}
                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            onBlur={() => void saveTitleEdit(task)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveTitleEdit(task);
                              if (e.key === "Escape") setEditing(null);
                            }}
                            disabled={savingEdit}
                            autoFocus
                            className="w-full bg-transparent text-[13px] text-[#1b1b1f] outline-none border-b border-[#5e6ad2]"
                          />
                        ) : (
                          <button
                            onClick={() => { setEditing(task._id); setEditTitle(task.title); }}
                            className={`block w-full text-left text-[13px] ${isCompleted ? "text-[#8b8d94] line-through" : "text-[#1b1b1f]"}`}
                          >
                            {task.title}
                          </button>
                        )}
                        {task.description && !isEditing && (
                          <p className={`mt-0.5 text-[11px] ${isCompleted ? "text-[#b4b5ba]" : "text-[#6b6f76]"} line-clamp-2`}>
                            {task.description}
                          </p>
                        )}

                        {/* Meta row */}
                        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                          {/* Assignee picker */}
                          <div className="relative inline-flex items-center gap-1.5 rounded-full bg-[#f5f5f7] pl-0.5 pr-2 py-0.5">
                            <LetterAvatar
                              name={displayName(assignee, task.assigneeEmail)}
                              src={assignee?.profilePhotoUrl ?? null}
                              size="xs"
                            />
                            <select
                              value={task.assigneeEmail}
                              onChange={(e) => void changeAssignee(task, e.target.value)}
                              className="bg-transparent text-[11px] font-medium text-[#3b3d44] outline-none cursor-pointer"
                            >
                              {members.map((m) => (
                                <option key={m.email} value={m.email}>
                                  {displayName(m, m.email)}{m.email === currentEmail ? " (you)" : ""}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Due date */}
                          <label className={`relative inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium cursor-pointer ${
                            due?.tone === "overdue" ? "bg-red-50 text-red-700"
                            : due?.tone === "warn" ? "bg-amber-50 text-amber-700"
                            : "bg-[#f5f5f7] text-[#6b6f76]"
                          }`}>
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <span>{due?.label ?? "No due date"}</span>
                            <input
                              type="date"
                              value={task.dueDate ?? ""}
                              onChange={(e) => void changeDueDate(task, e.target.value)}
                              className="absolute inset-0 opacity-0 cursor-pointer"
                            />
                          </label>

                          {/* Company tag */}
                          <ComboPicker
                            value={task.companyId ?? null}
                            items={companyOptions}
                            placeholder="Tag company"
                            emptyLabel={companies.length === 0 ? "No companies in workspace yet" : "No matches"}
                            selectedLabel={company ? companyDisplayName(company) : undefined}
                            selectedIcon={buildingIcon}
                            onChange={(id) => void changeTag(task, "companyId", id)}
                          />

                          {/* Person tag */}
                          <ComboPicker
                            value={task.personId ?? null}
                            items={personOptions}
                            placeholder="Tag person"
                            emptyLabel={persons.length === 0 ? "No people in workspace yet" : "No matches"}
                            selectedLabel={person ? personDisplayName(person) : undefined}
                            selectedIcon={personIcon}
                            onChange={(id) => void changeTag(task, "personId", id)}
                          />
                        </div>
                      </div>

                      {/* Delete */}
                      <button
                        onClick={() => void deleteTask(task)}
                        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity rounded p-1.5 text-[#8b8d94] hover:bg-red-50 hover:text-red-600"
                        title="Delete task"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
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
