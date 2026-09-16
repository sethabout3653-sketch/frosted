import React, { memo } from "react";
import { Search, Snowflake, MessageSquare, SlidersHorizontal, X } from "lucide-react";
import { formatTagLabel } from "../utils";

interface HeaderProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedTag: string;
  setSelectedTag: (tag: string) => void;
  tags: string[];
  onGoHome?: () => void;
  onChatClick?: () => void;
  onOpenSettings?: () => void;
  onOpenTheme?: () => void;
}

const Header = memo(function Header({
  searchQuery,
  setSearchQuery,
  selectedTag,
  setSelectedTag,
  tags,
  onGoHome,
  onChatClick,
  onOpenSettings,
  onOpenTheme,
}: HeaderProps) {
  const handleLogoClick = () => {
    setSearchQuery("");
    setSelectedTag("all");
    if (onGoHome) {
      onGoHome();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (onGoHome) {
      onGoHome();
    }
  };

  const handleClearSearch = () => {
    setSearchQuery("");
  };

  const handleTagSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedTag(val);
    if (onGoHome) {
      onGoHome();
    }
  };

  return (
    <header id="app-header" className="sticky top-0 z-40 w-full border-b border-[var(--theme-border-subtle)] bg-[var(--theme-darkest)]/95 px-4 py-3.5 md:px-8 shadow-lg shadow-black/30 backdrop-blur-md transition-colors duration-200">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Brand Logo with Frosted Emblem (clickable to go home & reset search) */}
        <button
          id="frosted-logo-btn"
          onClick={handleLogoClick}
          className="flex items-center gap-2.5 text-left group cursor-pointer focus:outline-none rounded-lg transition-transform duration-150 active:scale-95"
          title="Return to Home"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--theme-surface)] text-white border border-[var(--theme-border)] shadow-sm transition-transform duration-200 group-hover:scale-105">
            <Snowflake size={18} className="text-[var(--theme-text-accent)] transition-transform duration-300 group-hover:rotate-45" />
          </span>
          <h1 className="text-xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-neutral-100 to-[var(--theme-text-accent)] transition-all group-hover:opacity-90">
            Frosted Studying
          </h1>
        </button>

        {/* Search & Filter Panel */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-1 sm:justify-end">
          {/* Search Bar */}
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--theme-text-muted)] transition-colors pointer-events-none" />
            <input
              id="game-search-input"
              type="text"
              value={searchQuery}
              onChange={handleInputChange}
              placeholder="Search games..."
              style={{
                backgroundColor: "var(--theme-surface)",
                borderColor: "var(--theme-border-subtle)",
              }}
              className="h-9 w-full rounded-lg border pl-9 pr-8 text-xs text-white placeholder-neutral-400/60 transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-[var(--theme-border-strong)]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-[var(--theme-text-muted)] hover:text-white transition-colors"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Genre Category Filter and Chat */}
          <div className="flex items-center gap-2">
            <select
              id="tag-filter-select"
              value={selectedTag}
              onChange={handleTagSelect}
              style={{
                backgroundColor: "var(--theme-surface)",
                borderColor: "var(--theme-border-subtle)",
              }}
              className="h-9 w-full sm:w-44 rounded-lg border px-3 py-1 text-xs text-neutral-200 focus:outline-none focus:ring-1 focus:ring-[var(--theme-border-strong)] cursor-pointer transition-all duration-150"
            >
              <option value="all" style={{ backgroundColor: "var(--theme-darkest)" }} className="text-white">All Genres</option>
              {tags.map((tag) => (
                <option key={tag} value={tag} style={{ backgroundColor: "var(--theme-darkest)" }} className="text-white">
                  {formatTagLabel(tag)}
                </option>
              ))}
            </select>
            <button
              id="frosted-chat-tab-btn"
              onClick={onChatClick}
              style={{
                backgroundColor: "var(--theme-accent)",
                borderColor: "var(--theme-border)",
              }}
              className="h-9 rounded-full border px-4 py-1 text-xs font-bold text-white transition-all duration-150 cursor-pointer flex items-center gap-2 shadow-md hover:brightness-110 active:scale-95"
              title="Open Frosted Chat"
            >
              <MessageSquare size={15} className="text-[var(--theme-text-accent)]" />
              <span>Frosted Chat</span>
            </button>
            <button
              id="frosted-theme-btn"
              onClick={onOpenTheme}
              style={{
                backgroundColor: "var(--theme-surface)",
                borderColor: "var(--theme-border-subtle)",
              }}
              className="h-9 px-3 rounded-lg border text-white transition-all duration-150 cursor-pointer flex items-center gap-2 shadow-md hover:brightness-110 active:scale-95 flex-shrink-0"
              title="Color Wheel & Theme Customizer"
              aria-label="Color Wheel & Theme Customizer"
            >
              <div
                className="w-4 h-4 rounded-full border border-white/70 shadow-sm flex-shrink-0"
                style={{
                  background:
                    "conic-gradient(from 0deg, #00ffff, #00ff66, #80ff00, #ffff00, #ff0000, #ff00ff, #0000ff, #00ffff)",
                }}
              />
              <span className="text-xs font-bold hidden sm:inline">Theme</span>
            </button>
            <button
              id="frosted-settings-btn"
              onClick={onOpenSettings}
              style={{
                backgroundColor: "var(--theme-surface)",
                borderColor: "var(--theme-border-subtle)",
              }}
              className="h-9 w-9 rounded-lg border text-white transition-all duration-150 cursor-pointer flex items-center justify-center shadow-md hover:brightness-110 active:scale-95 flex-shrink-0"
              title="Settings"
              aria-label="Settings"
            >
              <SlidersHorizontal size={16} className="text-neutral-200 hover:text-white" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
});

export default Header;
