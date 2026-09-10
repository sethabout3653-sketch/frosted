import React, { useState, useEffect, useMemo, useCallback, useDeferredValue } from "react";
import { Game } from "./types";
import { fetchGamesList, getUniqueTags, isFnfGame, isFnfMod, deduplicateGames } from "./utils";
import { fetchLuminGames, getLocalLuminGames, fetchLuminSessionId, getLocalLuminGamesWithSession } from "./lumin";
import Header from "./components/Header";
import GameGrid from "./components/GameGrid";
import GamePlayer from "./components/GamePlayer";
import Chat from "./components/Chat";
import BackgroundEditor, { DEFAULT_BACKGROUND, AppBackground } from "./components/BackgroundEditor";
import SettingsModal from "./components/SettingsModal";
import { applyTabCloak, getSavedTabCloak } from "./tabCloaks";
import localZones from "./zones.json";

const SOUNDBOARD_GAME: Game = {
  id: "soundboard",
  name: "Soundboard",
  cover: "https://soundboardguys.com/favicon.ico",
  url: "https://soundboardguys.com/",
  author: "Soundboard Guys",
  source: "catalog",
  special: ["all genres", "soundboard"],
};

function prepareGame(g: Game, defaultSource: "catalog" | "luminsdk" = "catalog"): Game {
  const isFnf = isFnfGame(g.name, g.special);
  const isMod = isFnf && isFnfMod(g.name, g.special);

  // Clean internal tags and strip any previous FNF tags to ensure mutually exclusive categorization
  let sTags = g.special
    ? [
        ...g.special.filter((t) => {
          const clean = t.toLowerCase();
          return clean !== "luminsdk" && clean !== "fnf" && clean !== "fnf-mod";
        }),
      ]
    : [];

  // If it's an FNF mod: treat genre as "fnf-mod" ("FNF Mod")
  // If it's the 1 original vanilla game: treat genre as "fnf" ("FNF")
  if (isMod) {
    sTags.unshift("fnf-mod");
  } else if (isFnf) {
    sTags.unshift("fnf");
  }

  const searchTerms = [
    g.name,
    g.author || "",
    ...sTags,
    isFnf ? "fnf friday night funkin" : "",
    isMod ? "mod fnf mod fnf-mod" : "",
  ]
    .join(" ")
    .toLowerCase();

  return {
    ...g,
    source: g.source || defaultSource,
    special: sTags,
    isMod,
    _search: searchTerms,
  };
}

export default function App() {
  const [currentView, setCurrentView] = useState<"home" | "game" | "chat">("home");
  const [showStartup, setShowStartup] = useState(true);
  // Core games list state seeded synchronously with ALL catalog and Lumin games combined,
  // guaranteeing that on Vercel, offline, or slower networks, all 1,600+ games are present immediately.
  const [games, setGames] = useState<Game[]>(() => {
    const catalogPrepared = (localZones as Game[])
      .filter((g) => g.id !== -1 && g.name !== "-3" && g.id !== 816)
      .map((g) => prepareGame(g, "catalog"));
    const luminPrepared = getLocalLuminGames()
      .filter((g) => g.name !== "-3" && g.id !== 816)
      .map((g) => prepareGame(g, "luminsdk"));
    const catalog = deduplicateGames(catalogPrepared, luminPrepared).sort((a, b) => a.name.localeCompare(b.name));
    return [SOUNDBOARD_GAME, ...catalog];
  });
  const [loadingLive, setLoadingLive] = useState(true);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [background, setBackground] = useState<AppBackground>(() => {
    try { return JSON.parse(localStorage.getItem("frosted_background") || "null") || DEFAULT_BACKGROUND; } catch { return DEFAULT_BACKGROUND; }
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [missingTableError, setMissingTableError] = useState<string | null>(null);

  useEffect(() => {
    const handleMissingTable = (e: Event) => {
      const customEvent = e as CustomEvent;
      setMissingTableError(customEvent.detail);
    };
    window.addEventListener("supabase_missing_table", handleMissingTable);
    return () => window.removeEventListener("supabase_missing_table", handleMissingTable);
  }, []);

  useEffect(() => {
    // Automatically restore saved tab cloak on initial mount
    const saved = getSavedTabCloak();
    if (saved) {
      applyTabCloak(saved);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => setShowStartup(false), 2400);
    return () => window.clearTimeout(timeout);
  }, []);

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);
  const [selectedTag, setSelectedTag] = useState("all");

  // Fetch live games from GitHub assets and Lumin games on mount
  useEffect(() => {
    let isMounted = true;

    const loadLibraries = async () => {
      try {
        const [liveGamesResult, luminGamesResult] = await Promise.allSettled([
          fetchGamesList(),
          fetchLuminGames(),
        ]);

        if (!isMounted) return;

        const baseList: Game[] = (
          liveGamesResult.status === "fulfilled"
            ? liveGamesResult.value
            : (localZones as Game[])
        )
          .filter((g) => g.id !== -1 && g.name !== "-3" && g.id !== 816)
          .map((g) => prepareGame(g, "catalog"));

        let luminList: Game[] = [];
        if (luminGamesResult.status === "fulfilled" && luminGamesResult.value.length > 0) {
          luminList = luminGamesResult.value;
        } else {
          // If live fetch failed, attempt to fetch just a fresh session ID to rescue the local game covers
          const freshSessionId = await fetchLuminSessionId();
          if (freshSessionId) {
            luminList = getLocalLuminGamesWithSession(freshSessionId);
          } else {
            luminList = getLocalLuminGames();
          }
        }

        const luminPrepared = luminList.map((g) => prepareGame(g, "luminsdk"));

        // Deduplicate between gn-math catalog and Lumin, strictly preserving gn-math for Friday Night Funkin
        const combined = deduplicateGames(baseList, luminPrepared).sort((a, b) => a.name.localeCompare(b.name));
        setGames([SOUNDBOARD_GAME, ...combined.filter((g) => g.id !== SOUNDBOARD_GAME.id)]);
        setLoadingLive(false);
      } catch {
        if (isMounted) {
          setLoadingLive(false);
        }
      }
    };

    loadLibraries();

    return () => {
      isMounted = false;
    };
  }, []);

  // Total playable games count
  const totalPlayableCount = games.length;

  // Extract unique categories for tags list
  const tags = useMemo(() => {
    return getUniqueTags(games);
  }, [games]);

  // Handle URL state so users can share links directly to specific games
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gameIdStr = params.get("game");
    if (gameIdStr) {
      const game = games.find((g) => g.id.toString() === gameIdStr);
      if (game) {
        setSelectedGame(game);
      }
    }
  }, [games]);

  const handleSelectGame = useCallback((game: Game) => {
    setSelectedGame(game);
    setCurrentView("game");
    const url = new URL(window.location.href);
    url.searchParams.set("game", game.id.toString());
    window.history.pushState({}, "", url.toString());
  }, []);

  const handleBackToHub = useCallback(() => {
    setSelectedGame(null);
    setCurrentView("home");
    const url = new URL(window.location.href);
    url.searchParams.delete("game");
    window.history.pushState({}, "", url.toString());
  }, []);

  const handleOpenChat = useCallback(() => {
    setCurrentView("chat");
  }, []);

  // Ultra-fast pre-indexed filtering
  const processedGames = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    const hasQuery = query.length > 0;
    const hasTag = selectedTag !== "all";

    if (!hasQuery && !hasTag) {
      return games;
    }

    return games.filter((g) => {
      if (hasTag && !g.special?.includes(selectedTag)) {
        return false;
      }
      if (hasQuery && g._search && !g._search.includes(query)) {
        return false;
      }
      return true;
    });
  }, [games, selectedTag, deferredSearch]);

  const isSoundboardActive = currentView === "game" && (selectedGame?.id === "soundboard" || selectedGame?.name?.toLowerCase().includes("soundboard"));

  return (
    <>
      <div
        aria-hidden={!showStartup}
        className={`startup-splash ${showStartup ? "startup-splash-visible" : "startup-splash-hidden"}`}
      >
        <div className="startup-wordmark" aria-label="Frosted">Frosted</div>
      </div>
      <div id="app-root" className={`${(currentView === "game" && !isSoundboardActive) || currentView === "chat" ? "h-screen overflow-hidden" : "min-h-screen"} text-white antialiased font-sans flex flex-col selection:bg-white/20 selection:text-white`} style={{ background: background.type === "image" ? `url(${background.value}) center / cover fixed` : background.value }}>
      
      {/* Interactive Top Header Component */}
      <Header
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        selectedTag={selectedTag}
        setSelectedTag={setSelectedTag}
        tags={tags}
        onGoHome={handleBackToHub}
        onChatClick={handleOpenChat}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Main Content Area */}
      <main className={`flex-1 w-full flex flex-col ${isSoundboardActive ? "min-h-0 overflow-visible" : "min-h-0"}`}>
        <div className={currentView === "game" && selectedGame ? `flex-1 w-full flex flex-col ${isSoundboardActive ? "min-h-0 overflow-visible" : "min-h-0"}` : "hidden"}>
          {selectedGame && (
            <GamePlayer
              game={selectedGame}
              onBack={handleBackToHub}
            />
          )}
        </div>

        <div className={currentView === "home" ? "w-full max-w-7xl mx-auto px-4 py-6 md:px-8 flex-1 flex flex-col gap-6" : "hidden"}>
          {/* Catalog Grid View */}
          <section id="games-catalog-section" className="flex-1 flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <h2 className="text-base font-bold tracking-wider uppercase text-white flex items-center gap-2.5">
                  <span>Games ({processedGames.length})</span>
                </h2>
                {loadingLive && (
                  <span className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wider animate-pulse hidden sm:inline">
                    Loading games...
                  </span>
                )}
              </div>
            </div>

            <GameGrid
              games={processedGames}
              onSelectGame={handleSelectGame}
            />
          </section>
        </div>

        <div className={currentView === "chat" ? "flex-1 w-full flex flex-col min-h-0" : ""}>
          <Chat
            isOpen={currentView === "chat"}
            onClose={handleBackToHub}
            onOpenVoiceChat={() => setCurrentView("chat")}
            persistent
          />
        </div>
      </main>

      {/* Footer Branding Area (Home view only) */}
      {currentView === "home" && (
        <footer id="app-footer" className="border-t border-neutral-900 bg-black px-4 py-6 md:px-8 text-center text-xs text-neutral-500">
          <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="font-medium">
              &copy; 2026 FrostedStudying. Fast, unblocked browser games library.
            </p>
            <div className="flex flex-wrap gap-4 font-semibold">
              <a href="https://discord.gg/D4c9VFYWyU" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
                Community
              </a>
              <span className="text-neutral-800">|</span>
              <a href="https://github.com/gn-math" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
                GitHub Repositories
              </a>
            </div>
          </div>
        </footer>
      )}
  <BackgroundEditor background={background} onChange={setBackground} />
  <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
  
  {missingTableError && (
    <div className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-red-500/50 rounded-xl max-w-2xl w-full p-6 space-y-6">
        <h2 className="text-2xl font-bold text-red-400">Database Tables Missing in Supabase!</h2>
        <p className="text-neutral-300">
          We tried to read from the <code>{missingTableError}</code> table, but it doesn't exist in your Supabase project yet.
          The chat cannot work without the tables.
        </p>
        <p className="text-neutral-300">
          <strong>Please run the following SQL script in your Supabase dashboard (SQL Editor) to create them instantly:</strong>
        </p>
        <pre className="bg-black/50 p-4 rounded-lg overflow-x-auto text-xs font-mono text-emerald-400 border border-neutral-800">
{`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    "channelId" TEXT,
    uid TEXT,
    username TEXT,
    "photoURL" TEXT,
    text TEXT,
    gif TEXT,
    attachment TEXT,
    "attachmentName" TEXT,
    "attachmentType" TEXT,
    "attachmentSize" BIGINT,
    timestamp BIGINT,
    edited BOOLEAN
);

CREATE TABLE IF NOT EXISTS presence (
    uid TEXT PRIMARY KEY,
    username TEXT,
    "photoURL" TEXT,
    status TEXT,
    "lastSeen" BIGINT,
    "isMuted" BOOLEAN,
    "inVoice" BOOLEAN
);

CREATE TABLE IF NOT EXISTS voice_users (
    uid TEXT PRIMARY KEY,
    "channelId" TEXT,
    username TEXT,
    "photoURL" TEXT,
    "isMuted" BOOLEAN,
    "isVideoOn" BOOLEAN,
    "isVideoLoading" BOOLEAN,
    "isScreenSharing" BOOLEAN,
    "isScreenAudioOn" BOOLEAN,
    timestamp BIGINT
);

CREATE TABLE IF NOT EXISTS typing (
    id TEXT PRIMARY KEY,
    uid TEXT,
    username TEXT,
    "channelId" TEXT,
    timestamp BIGINT
);

CREATE TABLE IF NOT EXISTS signals (
    id TEXT PRIMARY KEY,
    "channelId" TEXT,
    uid TEXT,
    "targetUid" TEXT,
    type TEXT,
    "sdp" TEXT,
    "candidate" TEXT,
    "sdpMid" TEXT,
    "sdpMLineIndex" INT,
    timestamp BIGINT
);

ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE presence;
ALTER PUBLICATION supabase_realtime ADD TABLE voice_users;
ALTER PUBLICATION supabase_realtime ADD TABLE typing;
ALTER PUBLICATION supabase_realtime ADD TABLE signals;

ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE presence DISABLE ROW LEVEL SECURITY;
ALTER TABLE voice_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE typing DISABLE ROW LEVEL SECURITY;
ALTER TABLE signals DISABLE ROW LEVEL SECURITY;`}
        </pre>
        <div className="flex justify-end pt-2">
          <button
            onClick={() => setMissingTableError(null)}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-medium rounded transition-colors"
          >
            I have run the SQL, dismiss
          </button>
        </div>
      </div>
    </div>
  )}
  
  </div>
  </>
  );
}
