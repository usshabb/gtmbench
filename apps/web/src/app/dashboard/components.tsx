"use client";

/* Shared dashboard components */

import { useState } from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";

const AVATAR_COLORS = [
  { bg: "bg-rose-100", text: "text-rose-600" },
  { bg: "bg-pink-100", text: "text-pink-600" },
  { bg: "bg-fuchsia-100", text: "text-fuchsia-600" },
  { bg: "bg-purple-100", text: "text-purple-600" },
  { bg: "bg-violet-100", text: "text-violet-600" },
  { bg: "bg-indigo-100", text: "text-indigo-600" },
  { bg: "bg-blue-100", text: "text-blue-600" },
  { bg: "bg-sky-100", text: "text-sky-600" },
  { bg: "bg-cyan-100", text: "text-cyan-600" },
  { bg: "bg-teal-100", text: "text-teal-600" },
  { bg: "bg-emerald-100", text: "text-emerald-600" },
  { bg: "bg-amber-100", text: "text-amber-700" },
  { bg: "bg-orange-100", text: "text-orange-600" },
  { bg: "bg-red-100", text: "text-red-600" },
];

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

const SIZE_CLASSES = {
  xs: "h-8 w-8 text-[11px]",
  sm: "h-9 w-9 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-xl",
};

export function LetterAvatar({
  name,
  size = "sm",
  rounded = "full",
  src,
}: {
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  rounded?: "full" | "lg";
  src?: string | null;
}) {
  const color = AVATAR_COLORS[hashName(name) % AVATAR_COLORS.length];
  const initials = getInitials(name);
  const roundedClass = rounded === "full" ? "rounded-full" : "rounded-md";

  return (
    <AvatarPrimitive.Root
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden ${SIZE_CLASSES[size]} ${roundedClass}`}
    >
      {src && (
        <AvatarPrimitive.Image
          src={src}
          alt={name}
          className={`h-full w-full object-cover ${roundedClass}`}
        />
      )}
      <AvatarPrimitive.Fallback
        className={`flex h-full w-full items-center justify-center font-medium ${color.bg} ${color.text}`}
      >
        {initials}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

/**
 * Image that falls back to children when src fails to load.
 */
export function FallbackImg({
  src,
  alt,
  className,
  style,
  children,
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const [err, setErr] = useState(false);
  if (!src || err) return <>{children}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt ?? ""} className={className} style={style} onError={() => setErr(true)} />
  );
}

/* Custom event for data refresh */
export const DATA_CHANGED_EVENT = "gtmbench:data-changed";

export function dispatchDataChanged() {
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT));
}

/* Custom event to trigger global action modal from any page */
export const GLOBAL_ACTION_EVENT = "gtmbench:global-action";

export function dispatchGlobalAction(type: "company" | "person") {
  window.dispatchEvent(new CustomEvent(GLOBAL_ACTION_EVENT, { detail: { type } }));
}

/**
 * Safely parse a fetch Response as JSON.
 * Throws a readable error if the response is not JSON (e.g. HTML 404 page).
 */
export async function safeJson<T = unknown>(res: Response): Promise<T> {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    throw new Error(
      `Expected JSON from ${res.url} but got ${contentType || "unknown content-type"} (HTTP ${res.status}): ${text.slice(0, 120)}`,
    );
  }
  return res.json() as Promise<T>;
}

/**
 * Wrapper around fetch that automatically attaches the x-api-key header.
 */
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";

export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (API_KEY) headers.set("x-api-key", API_KEY);
  return fetch(url, { ...init, headers });
}
