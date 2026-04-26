"use client";

import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import type Quill from "quill";

export interface RichEditorHandle {
  getHTML: () => string;
  getText: () => string;
  insertText: (text: string) => void;
  insertHTML: (html: string) => void;
  focus: () => void;
  getQuill: () => Quill | null;
}

interface RichEditorProps {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

const RichEditor = forwardRef<RichEditorHandle, RichEditorProps>(
  ({ value, onChange, placeholder, autoFocus, className }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const quillRef = useRef<Quill | null>(null);
    const onChangeRef = useRef(onChange);
    const isSettingValue = useRef(false);

    onChangeRef.current = onChange;

    useImperativeHandle(ref, () => ({
      getHTML: () => quillRef.current?.root.innerHTML ?? "",
      getText: () => quillRef.current?.getText() ?? "",
      insertText: (text: string) => {
        const q = quillRef.current;
        if (!q) return;
        const range = q.getSelection(true);
        q.insertText(range.index, text);
      },
      insertHTML: (html: string) => {
        const q = quillRef.current;
        if (!q) return;
        const range = q.getSelection(true);
        q.clipboard.dangerouslyPasteHTML(range.index, html);
      },
      focus: () => quillRef.current?.focus(),
      getQuill: () => quillRef.current,
    }));

    const initQuill = useCallback(async () => {
      if (!containerRef.current || quillRef.current) return;

      const QuillModule = (await import("quill")).default;

      const editorDiv = document.createElement("div");
      containerRef.current.appendChild(editorDiv);

      const q = new QuillModule(editorDiv, {
        theme: "snow",
        placeholder: placeholder ?? "Write your message...",
        modules: {
          toolbar: [
            ["bold", "italic", "underline", "strike"],
            [{ list: "bullet" }],
            ["link"],
            ["clean"],
          ],
        },
      });

      quillRef.current = q;

      // Set initial value
      if (value) {
        isSettingValue.current = true;
        q.clipboard.dangerouslyPasteHTML(value);
        isSettingValue.current = false;
      }

      // Listen for changes
      q.on("text-change", () => {
        if (isSettingValue.current) return;
        const html = q.root.innerHTML;
        onChangeRef.current?.(html === "<p><br></p>" ? "" : html);
      });

      if (autoFocus) {
        requestAnimationFrame(() => q.focus());
      }
    }, [placeholder, autoFocus, value]);

    useEffect(() => {
      void initQuill();

      return () => {
        if (quillRef.current) {
          quillRef.current = null;
        }
        if (containerRef.current) {
          const editor = containerRef.current.querySelector(".ql-toolbar");
          if (editor) editor.remove();
          const editorContainer = containerRef.current.querySelector(".ql-container");
          if (editorContainer) editorContainer.remove();
        }
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sync external value changes
    useEffect(() => {
      const q = quillRef.current;
      if (!q) return;
      const currentHtml = q.root.innerHTML;
      const normalizedCurrent = currentHtml === "<p><br></p>" ? "" : currentHtml;
      if (value !== undefined && value !== normalizedCurrent) {
        isSettingValue.current = true;
        const selection = q.getSelection();
        q.root.innerHTML = value || "";
        if (selection) {
          requestAnimationFrame(() => {
            try { q.setSelection(selection); } catch { /* ignore */ }
          });
        }
        isSettingValue.current = false;
      }
    }, [value]);

    return (
      <div ref={containerRef} className={className} />
    );
  },
);

RichEditor.displayName = "RichEditor";

export default RichEditor;
