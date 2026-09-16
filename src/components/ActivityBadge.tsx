import React from "react";
import { Gamepad2, Search, MessageSquare, Compass, Volume2, Sparkles } from "lucide-react";
import { UserActivity } from "../types";

interface ActivityBadgeProps {
  activity?: UserActivity | null;
  compact?: boolean;
  className?: string;
}

export default function ActivityBadge({
  activity,
  compact = false,
  className = "",
}: ActivityBadgeProps) {
  if (!activity) return null;

  const { type, gameName, query, tag, channel, text } = activity;

  // 1. Playing Game Status
  if (type === "playing") {
    const title = gameName ? `Playing ${gameName}` : text || "Playing Game";
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[var(--theme-indigo-950)] border border-[var(--theme-border)] text-[var(--theme-text-accent)] font-semibold shadow-sm ${
          compact ? "text-[10px]" : "text-xs"
        } ${className}`}
        title={title}
      >
        <Gamepad2 size={compact ? 11 : 13} className="text-[var(--theme-indigo-400)] animate-pulse flex-shrink-0" />
        <span className="truncate max-w-[140px] font-bold text-white tracking-wide">
          {title}
        </span>
      </div>
    );
  }

  // 2. Searching for Games Status
  if (type === "searching") {
    const title = query ? `Searching: "${query}"` : text || "Searching for games";
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-950/60 border border-amber-500/30 text-amber-200 font-medium ${
          compact ? "text-[10px]" : "text-xs"
        } ${className}`}
        title={title}
      >
        <Search size={compact ? 10 : 12} className="text-amber-400 flex-shrink-0" />
        <span className="truncate max-w-[140px] text-amber-100">
          {title}
        </span>
      </div>
    );
  }

  // 3. In Chat Status
  if (type === "chatting") {
    const title = channel ? `In #${channel}` : text || "In Frosted Chat";
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[var(--theme-accent)] border border-[var(--theme-border)] text-[var(--theme-text-accent)] font-medium ${
          compact ? "text-[10px]" : "text-xs"
        } ${className}`}
        title={title}
      >
        <MessageSquare size={compact ? 10 : 12} className="text-[var(--theme-indigo-400)] flex-shrink-0" />
        <span className="truncate max-w-[140px] text-[var(--theme-text-accent)]">
          {title}
        </span>
      </div>
    );
  }

  // 4. Scrolling / Browsing Games Catalog
  if (type === "scrolling") {
    const title = tag && tag !== "all" ? `Browsing ${tag}` : text || "Scrolling games";
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-950/60 border border-emerald-500/30 text-emerald-200 font-medium ${
          compact ? "text-[10px]" : "text-xs"
        } ${className}`}
        title={title}
      >
        <Compass size={compact ? 10 : 12} className="text-emerald-400 flex-shrink-0" />
        <span className="truncate max-w-[140px] text-emerald-100">
          {title}
        </span>
      </div>
    );
  }

  // Default fallback
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-neutral-900 border border-neutral-700/50 text-neutral-300 ${
        compact ? "text-[10px]" : "text-xs"
      } ${className}`}
    >
      <Sparkles size={compact ? 10 : 12} className="text-neutral-400" />
      <span className="truncate max-w-[140px]">{text || "Online"}</span>
    </div>
  );
}
