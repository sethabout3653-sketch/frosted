import React, { useState, useEffect, memo } from "react";
import { Search, Snowflake } from "lucide-react";
import { formatTagLabel } from "../utils";

interface HeaderProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedTag: string;
  setSelectedTag: (tag: string) => void;
  tags: string[];
}

const Header = memo(function Header({
  searchQuery,
  setSearchQuery,
  selectedTag,
  setSelectedTag,
  tags,
}: HeaderProps) {
  const [localQuery, setLocalQuery] = useState(searchQuery);

  // Synchronize local input if cleared from external state
  useEffect(() => {
    setLocalQuery(searchQuery);
  }, [searchQuery]);

  // Debounce search update to parent
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(localQuery);
    }, 90);
    return () => clearTimeout(timer);
  }, [localQuery, setSearchQuery]);

  return (
    <header id="app-header" className="sticky top-0 z-40 w-full border-b border-neutral-800 bg-black/85 px-4 py-3.5 md:px-8 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Brand Logo with Frosted Emblem */}
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white border border-white/20 backdrop-blur-md shadow-sm">
            <Snowflake size={18} className="text-white" />
          </span>
          <h1 className="text-xl font-bold tracking-tight text-white lowercase">
            frosted
          </h1>
        </div>

        {/* Black and White Search & Filter Panel */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-1 sm:justify-end">
          {/* Search Bar */}
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-neutral-500" />
            <input
              id="game-search-input"
              type="text"
              value={localQuery}
              onChange={(e) => setLocalQuery(e.target.value)}
              placeholder="Search games..."
              className="h-9 w-full rounded-lg border border-neutral-800 bg-neutral-900/80 pl-9 pr-3 text-xs text-white placeholder-neutral-500 transition-all focus:border-white focus:bg-neutral-900 focus:outline-none focus:ring-1 focus:ring-white"
            />
          </div>

          {/* Genre Category Filter */}
          <div className="relative">
            <select
              id="tag-filter-select"
              value={selectedTag}
              onChange={(e) => setSelectedTag(e.target.value)}
              className="h-9 w-full sm:w-44 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1 text-xs text-neutral-300 focus:border-white focus:outline-none focus:ring-1 focus:ring-white cursor-pointer"
            >
              <option value="all">All Genres</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {formatTagLabel(tag)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </header>
  );
});

export default Header;

