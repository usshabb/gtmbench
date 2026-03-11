/* Shared dashboard components */

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

export function LetterAvatar({
  name,
  size = "sm",
  rounded = "full",
}: {
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  rounded?: "full" | "lg";
}) {
  const color = AVATAR_COLORS[hashName(name) % AVATAR_COLORS.length];
  const initials = getInitials(name);

  const sizeClasses = {
    xs: "h-8 w-8 text-[11px]",
    sm: "h-9 w-9 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-16 w-16 text-xl",
  };

  const roundedClass = rounded === "full" ? "rounded-full" : "rounded-lg";

  return (
    <div
      className={`flex shrink-0 items-center justify-center font-semibold ${sizeClasses[size]} ${roundedClass} ${color.bg} ${color.text}`}
    >
      {initials}
    </div>
  );
}

/* Custom event for data refresh */
export const DATA_CHANGED_EVENT = "gtmbench:data-changed";

export function dispatchDataChanged() {
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT));
}
