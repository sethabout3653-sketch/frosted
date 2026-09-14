import React, { useState, useEffect, memo, useRef } from "react";
import { Search, Snowflake, MessageSquare, SlidersHorizontal, Phone, Users, Video, ChevronDown } from "lucide-react";
import { formatTagLabel } from "../utils";
import { useCall } from "../context/CallContext";

export interface OnlineUser {
  uid: string;
  username: string;
  photoURL: string;
  activity?: string;
  currentGame?: string | null;
  currentView?: string;
  lastSeen?: number;
}

interface HeaderProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedTag: string;
  setSelectedTag: (tag: string) => void;
  tags: string[];
  onlineUsers?: OnlineUser[];
  currentUid?: string;
  onGoHome?: () => void;
  onChatClick?: () => void;
  onOpenSettings?: () => void;
  onOpenCall?: () => void;
}

const Header = memo(function Header({
  searchQuery,
  setSearchQuery,
  selectedTag,
  setSelectedTag,
  tags,
  onlineUsers = [],
  currentUid,
  onGoHome,
  onChatClick,
  onOpenSettings,
  onOpenCall,
}: HeaderProps) {
  const [localQuery, setLocalQuery] = useState(searchQuery);
  const [showOnlineDropdown, setShowOnlineDropdown] = useState(false);
  const onlineDropdownRef = useRef<HTMLDivElement>(null);
  const { startCall } = useCall();

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (onlineDropdownRef.current && !onlineDropdownRef.current.contains(e.target as Node)) {
        setShowOnlineDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

  const handleLogoClick = () => {
    setLocalQuery("");
    setSearchQuery("");
    setSelectedTag("all");
    if (onGoHome) {
      onGoHome();
    }
  };

  return (
    <header id="app-header" className="sticky top-0 z-40 w-full border-b border-neutral-800 bg-black/85 px-4 py-3.5 md:px-8 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Brand Logo with Frosted Emblem (clickable to go home & reset search) */}
        <button
          id="frosted-logo-btn"
          onClick={handleLogoClick}
          className="flex items-center gap-2.5 text-left group cursor-pointer focus:outline-none rounded-lg transition-transform active:scale-95"
          title="Return to Home"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white border border-white/20 backdrop-blur-md shadow-sm transition-all group-hover:bg-white/20 group-hover:border-white/40">
            <Snowflake size={18} className="text-white transition-transform group-hover:rotate-45" />
          </span>
          <h1 className="text-xl font-bold tracking-tight text-white transition-colors group-hover:text-neutral-200">
            FrostedStudying
          </h1>
        </button>

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

          {/* Genre Category Filter, Online Users Pill, Chat and Call */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="tag-filter-select"
              value={selectedTag}
              onChange={(e) => setSelectedTag(e.target.value)}
              className="h-9 w-full sm:w-36 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1 text-xs text-neutral-300 focus:border-white focus:outline-none focus:ring-1 focus:ring-white cursor-pointer"
            >
              <option value="all">All Genres</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {formatTagLabel(tag)}
                </option>
              ))}
            </select>

            {/* Online Users Pill & Popover Dropdown (Always visible on Home, Game, Chat) */}
            <div className="relative" ref={onlineDropdownRef}>
              <button
                id="frosted-online-users-btn"
                onClick={() => setShowOnlineDropdown((prev) => !prev)}
                className="h-9 rounded-full border border-emerald-500/30 bg-emerald-950/40 hover:bg-emerald-900/60 px-3 py-1 text-xs font-bold text-emerald-400 hover:text-white transition-all cursor-pointer flex items-center gap-2 shadow-sm active:scale-95 flex-shrink-0"
                title="View Who Is Online"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>

                {/* Avatar preview stack */}
                {onlineUsers.length > 0 && (
                  <div className="flex -space-x-1.5 overflow-hidden">
                    {onlineUsers.slice(0, 3).map((u, idx) => (
                      <div
                        key={`${u.uid}-${idx}`}
                        className="inline-block h-4 w-4 rounded-full ring-1 ring-black overflow-hidden bg-neutral-800 text-[8px] font-bold text-white flex items-center justify-center flex-shrink-0"
                      >
                        {u.photoURL ? (
                          <img src={u.photoURL} alt={u.username} className="h-full w-full object-cover" />
                        ) : (
                          (u.username || "?").charAt(0).toUpperCase()
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <span>{onlineUsers.length} Online</span>
                <ChevronDown size={13} className={`transition-transform duration-200 ${showOnlineDropdown ? "rotate-180" : ""}`} />
              </button>

              {/* Online Users Popover Panel */}
              {showOnlineDropdown && (
                <div className="absolute right-0 mt-2 w-72 sm:w-80 bg-[#0d0d11]/95 border border-neutral-800 rounded-2xl shadow-2xl backdrop-blur-xl p-3 z-50 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-neutral-800/80">
                    <div className="flex items-center gap-2">
                      <Users size={14} className="text-emerald-400" />
                      <span className="text-xs font-bold text-white">Online Now ({onlineUsers.length})</span>
                    </div>
                    <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-950/80 border border-emerald-800/60 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live
                    </span>
                  </div>

                  <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                    {onlineUsers.length === 0 ? (
                      <p className="text-xs text-neutral-500 text-center py-4 font-medium">No users online right now</p>
                    ) : (
                      onlineUsers.map((user) => {
                        const isMe = user.uid === currentUid;
                        return (
                          <div
                            key={user.uid}
                            className="flex items-center justify-between p-2 rounded-xl hover:bg-neutral-800/70 transition-colors group"
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <div className="relative flex-shrink-0">
                                <div className="w-8 h-8 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 flex items-center justify-center text-xs font-bold text-white">
                                  {user.photoURL ? (
                                    <img src={user.photoURL} alt={user.username} className="w-full h-full object-cover" />
                                  ) : (
                                    (user.username || "?").charAt(0).toUpperCase()
                                  )}
                                </div>
                                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#0d0d11]" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-bold text-white truncate">{user.username}</span>
                                  {isMe && (
                                    <span className="bg-emerald-950 text-emerald-400 border border-emerald-800/80 text-[8px] font-bold px-1 rounded uppercase">YOU</span>
                                  )}
                                </div>
                                <p className="text-[10px] text-neutral-400 truncate font-medium">
                                  {user.activity || (user.currentGame ? `Playing ${user.currentGame}` : user.currentView === "chat" ? "In Chat" : "Browsing Games")}
                                </p>
                              </div>
                            </div>

                            {!isMe && (
                              <div className="flex items-center gap-1 opacity-90 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                <button
                                  onClick={() => {
                                    setShowOnlineDropdown(false);
                                    startCall({ uid: user.uid, username: user.username, photoURL: user.photoURL || "" }, false);
                                  }}
                                  className="p-1.5 rounded-lg bg-emerald-950/80 border border-emerald-800/80 hover:bg-emerald-600 text-emerald-400 hover:text-white transition-all cursor-pointer"
                                  title={`Voice Call ${user.username}`}
                                >
                                  <Phone size={12} />
                                </button>
                                <button
                                  onClick={() => {
                                    setShowOnlineDropdown(false);
                                    startCall({ uid: user.uid, username: user.username, photoURL: user.photoURL || "" }, true);
                                  }}
                                  className="p-1.5 rounded-lg bg-indigo-950/80 border border-indigo-800/80 hover:bg-indigo-600 text-indigo-400 hover:text-white transition-all cursor-pointer"
                                  title={`Video Call ${user.username}`}
                                >
                                  <Video size={12} />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {onOpenCall && (
              <button
                id="frosted-call-header-btn"
                onClick={onOpenCall}
                className="h-9 rounded-full border border-emerald-800/80 bg-emerald-950/80 hover:bg-emerald-900 px-3.5 py-1 text-xs font-bold text-emerald-400 hover:text-white transition-all cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-95"
                title="Direct Calls & Ringtone"
              >
                <Phone size={14} />
                <span className="hidden md:inline">Call</span>
              </button>
            )}
            <button
              id="frosted-chat-tab-btn"
              onClick={onChatClick}
              className="h-9 rounded-full border border-neutral-800 bg-neutral-900/90 hover:bg-neutral-800 px-4 py-1 text-xs font-bold text-white transition-all cursor-pointer flex items-center gap-2 shadow-sm hover:border-neutral-700 active:scale-95"
              title="Open Frosted Chat"
            >
              <MessageSquare size={15} className="text-white" />
              <span>Frosted Chat</span>
            </button>
            <button
              id="frosted-settings-btn"
              onClick={onOpenSettings}
              className="h-9 w-9 rounded-lg border border-neutral-800 bg-neutral-900/90 hover:bg-neutral-800 text-white transition-all cursor-pointer flex items-center justify-center shadow-sm hover:border-neutral-700 active:scale-95 flex-shrink-0"
              title="Settings"
              aria-label="Settings"
            >
              <SlidersHorizontal size={16} className="text-white" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
});

export default Header;

