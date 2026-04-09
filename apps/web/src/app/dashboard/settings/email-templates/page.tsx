"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../components";

const localStorageTokenKey = "gtmbench-token";

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
}

interface Template {
  _id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

const TOKENS = [
  { token: "first_name", label: "First Name" },
  { token: "full_name", label: "Full Name" },
  { token: "email", label: "Their Email" },
  { token: "website", label: "Company Website" },
  { token: "ats_name", label: "ATS Name" },
];

export default function EmailTemplatesPage() {
  const router = useRouter();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const [authToken, setAuthToken] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  // Editor state
  const [editingId, setEditingId] = useState<string | null>(null); // null = new
  const [showEditor, setShowEditor] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Signature state
  const [signature, setSignature] = useState("");
  const [signatureDraft, setSignatureDraft] = useState("");
  const [savingSignature, setSavingSignature] = useState(false);
  const [signatureSaved, setSignatureSaved] = useState(false);

  // Token autocomplete
  const [showTokenMenu, setShowTokenMenu] = useState(false);
  const [tokenFilter, setTokenFilter] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const cursorPosRef = useRef(0);

  const checkedRef = useRef(false);

  useEffect(() => {
    const token = window.localStorage.getItem(localStorageTokenKey);
    if (!token) { router.replace("/"); return; }
    setAuthToken(token);
    if (checkedRef.current) return;
    checkedRef.current = true;

    void Promise.all([
      apiFetch(`${apiBaseUrl}/email-templates`, { headers: { Authorization: `Bearer ${token}` } })
        .then(async (res) => {
          const data = (await res.json()) as { templates: Template[] };
          setTemplates(data.templates ?? []);
        }),
      apiFetch(`${apiBaseUrl}/email-signature`, { headers: { Authorization: `Bearer ${token}` } })
        .then(async (res) => {
          const data = (await res.json()) as { signature: string };
          setSignature(data.signature ?? "");
          setSignatureDraft(data.signature ?? "");
        }),
    ]).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchTemplates = useCallback(async () => {
    const res = await apiFetch(`${apiBaseUrl}/email-templates`, { headers: { Authorization: `Bearer ${authToken}` } });
    const data = (await res.json()) as { templates: Template[] };
    setTemplates(data.templates ?? []);
  }, [apiBaseUrl, authToken]);

  function openNew() {
    setEditingId(null);
    setTitle("");
    setBody("");
    setError("");
    setShowEditor(true);
  }

  function openEdit(t: Template) {
    setEditingId(t._id);
    setTitle(t.title);
    setBody(t.body);
    setError("");
    setShowEditor(true);
  }

  async function handleSave() {
    if (!title.trim() || !body.trim()) { setError("Title and body are required"); return; }
    setSaving(true);
    setError("");
    try {
      const method = editingId ? "PUT" : "POST";
      const url = editingId ? `${apiBaseUrl}/email-templates/${editingId}` : `${apiBaseUrl}/email-templates`;
      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ title: title.trim(), body: body.trim() }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? "Failed to save");
      }
      await fetchTemplates();
      setShowEditor(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await apiFetch(`${apiBaseUrl}/email-templates/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    setTemplates((prev) => prev.filter((t) => t._id !== id));
    if (editingId === id) setShowEditor(false);
  }

  async function handleSaveSignature() {
    setSavingSignature(true);
    try {
      await apiFetch(`${apiBaseUrl}/email-signature`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ body: signatureDraft }),
      });
      setSignature(signatureDraft);
      setSignatureSaved(true);
      setTimeout(() => setSignatureSaved(false), 2000);
    } catch { /* ignore */ }
    finally { setSavingSignature(false); }
  }

  // Handle body textarea changes — detect {{ for token autocomplete
  function handleBodyChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    const cursor = e.target.selectionStart ?? 0;
    setBody(val);
    cursorPosRef.current = cursor;

    // Check if the two chars before cursor are {{
    const before = val.slice(0, cursor);
    const lastOpen = before.lastIndexOf("{{");
    if (lastOpen !== -1) {
      const between = before.slice(lastOpen + 2);
      // No closing }} yet
      if (!between.includes("}}")) {
        setTokenFilter(between.toLowerCase());
        setShowTokenMenu(true);
        return;
      }
    }
    setShowTokenMenu(false);
  }

  function insertToken(token: string) {
    const ta = bodyRef.current;
    if (!ta) return;
    const cursor = cursorPosRef.current;
    const before = body.slice(0, cursor);
    const lastOpen = before.lastIndexOf("{{");
    const after = body.slice(cursor);
    const newBody = before.slice(0, lastOpen) + `{{${token}}}` + after;
    setBody(newBody);
    setShowTokenMenu(false);

    // Restore focus and cursor position
    const newCursor = lastOpen + token.length + 4; // {{token}}
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newCursor, newCursor);
    });
  }

  const filteredTokens = TOKENS.filter((t) =>
    t.label.toLowerCase().includes(tokenFilter) || t.token.toLowerCase().includes(tokenFilter)
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#d4d4d8] border-t-[#6b6f76]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-8 py-8 space-y-8">
      {/* Signature section */}
      <div>
        <div className="mb-3">
          <h1 className="text-[17px] font-semibold text-[#1b1b1f]">Email Signature</h1>
          <p className="mt-0.5 text-[13px] text-[#6b6f76]">Added to the end of every email you send.</p>
        </div>
        <div className="rounded-lg border border-[#e6e6e9] bg-white">
          <div className="px-4 py-3">
            <textarea
              value={signatureDraft}
              onChange={(e) => { setSignatureDraft(e.target.value); setSignatureSaved(false); }}
              rows={3}
              placeholder="e.g. John Doe\nCTO @ Acme Inc."
              className="w-full rounded-md border border-[#e6e6e9] px-3 py-2 text-[13px] placeholder:text-[#b4b5ba] focus:border-[#5e6ad2] focus:outline-none focus:ring-1 focus:ring-[#5e6ad2]/20 resize-none leading-relaxed"
            />
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-[#ededf0] px-4 py-2.5">
            {signatureSaved && <span className="text-[12px] text-[#059669]">Saved</span>}
            <button
              onClick={handleSaveSignature}
              disabled={savingSignature || signatureDraft === signature}
              className="rounded-md bg-[#1b1b1f] px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-[#2c2c33] disabled:opacity-40 transition-colors"
            >
              {savingSignature ? "Saving..." : "Save signature"}
            </button>
          </div>
        </div>
      </div>

      {/* Templates section */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[17px] font-semibold text-[#1b1b1f]">Email Templates</h1>
          <p className="mt-0.5 text-[13px] text-[#6b6f76]">Create reusable templates with placeholder tokens.</p>
        </div>
        <button
          onClick={openNew}
          className="rounded-md bg-[#1b1b1f] px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-[#2c2c33] transition-colors"
        >
          New template
        </button>
      </div>

      {/* Editor */}
      {showEditor && (
        <div className="rounded-lg border border-[#e6e6e9] bg-white">
          <div className="border-b border-[#ededf0] px-4 py-3 flex items-center justify-between">
            <p className="text-[13px] font-semibold text-[#1b1b1f]">{editingId ? "Edit template" : "New template"}</p>
            <button onClick={() => setShowEditor(false)} className="text-[#8b8d94] hover:text-[#6b6f76]">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="px-4 py-4 space-y-3">
            <div>
              <label className="block text-[12px] font-medium text-[#6b6f76] mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Cold outreach intro"
                className="w-full rounded-md border border-[#e6e6e9] px-3 py-2 text-[13px] placeholder:text-[#b4b5ba] focus:border-[#5e6ad2] focus:outline-none focus:ring-1 focus:ring-[#5e6ad2]/20"
                autoFocus
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[12px] font-medium text-[#6b6f76]">Body</label>
                <span className="text-[11px] text-[#8b8d94]">
                  Type <code className="rounded bg-[#f5f5f7] px-1 py-0.5 text-[10px] font-mono">{"{{"}</code> to insert a token
                </span>
              </div>
              <div className="relative">
                <textarea
                  ref={bodyRef}
                  value={body}
                  onChange={handleBodyChange}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setShowTokenMenu(false);
                  }}
                  rows={8}
                  placeholder={"Hi {{first_name}},\n\nI noticed your team at..."}
                  className="w-full rounded-md border border-[#e6e6e9] px-3 py-2 text-[13px] placeholder:text-[#b4b5ba] focus:border-[#5e6ad2] focus:outline-none focus:ring-1 focus:ring-[#5e6ad2]/20 resize-none font-mono leading-relaxed"
                />
                {/* Token autocomplete dropdown */}
                {showTokenMenu && filteredTokens.length > 0 && (
                  <div className="absolute left-0 bottom-full mb-1 w-64 rounded-lg border border-[#e6e6e9] bg-white shadow-lg z-10 overflow-hidden">
                    <div className="px-3 py-1.5 border-b border-[#ededf0]">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-[#8b8d94]">Insert token</p>
                    </div>
                    {filteredTokens.map((t) => (
                      <button
                        key={t.token}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); insertToken(t.token); }}
                        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-[#f9f9fb] transition-colors"
                      >
                        <span className="text-[12px] font-medium text-[#1b1b1f]">{t.label}</span>
                        <code className="text-[11px] text-[#8b8d94] font-mono">{`{{${t.token}}}`}</code>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {error && <p className="text-[12px] text-red-500">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-[#ededf0] px-4 py-3">
            <button onClick={() => setShowEditor(false)} className="rounded-md border border-[#e6e6e9] px-3 py-1.5 text-[12px] font-medium text-[#6b6f76] hover:bg-[#f5f5f7]">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-[#1b1b1f] px-4 py-1.5 text-[12px] font-medium text-white hover:bg-[#2c2c33] disabled:opacity-60"
            >
              {saving ? "Saving..." : editingId ? "Save changes" : "Create template"}
            </button>
          </div>
        </div>
      )}

      {/* Template list */}
      {templates.length === 0 && !showEditor ? (
        <div className="rounded-lg border border-dashed border-[#e6e6e9] px-6 py-10 text-center">
          <p className="text-[13px] text-[#8b8d94]">No templates yet. Create one to speed up your email outreach.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-[#e6e6e9] divide-y divide-[#ededf0]">
          {templates.map((t) => (
            <div key={t._id} className="flex items-start gap-3 px-4 py-3 group">
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-[#1b1b1f] truncate">{t.title}</p>
                <p className="mt-0.5 text-[12px] text-[#8b8d94] line-clamp-1 font-mono">{t.body}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => openEdit(t)}
                  className="rounded-md p-1.5 text-[#8b8d94] hover:bg-[#f5f5f7] hover:text-[#6b6f76]"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                </button>
                <button
                  onClick={() => handleDelete(t._id)}
                  className="rounded-md p-1.5 text-[#8b8d94] hover:bg-red-50 hover:text-red-500"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
