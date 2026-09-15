import React, { useState, useEffect, useMemo, useCallback, useDeferredValue } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Game } from "./types";
import { fetchGamesList, getUniqueTags, isFnfGame, isFnfMod, deduplicateGames } from "./utils";
import { fetchLuminGames, getLocalLuminGames, fetchLuminSessionId, getLocalLuminGamesWithSession } from "./lumin";
import Header from "./components/Header";
import GameGrid from "./components/GameGrid";
import GamePlayer from "./components/GamePlayer";
import Chat from "./components/Chat";
import BackgroundEditor, { DEFAULT_BACKGROUND, AppBackground } from "./components/BackgroundEditor";
import SettingsModal from "./components/SettingsModal";
import LoadingScreen from "./components/LoadingScreen";
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
    const catalog = deduplicateGames(catalogPrepared, luminPrepared).sort((a, b) => (a?.name || "").localeCompare(b?.name || ""));
    return [SOUNDBOARD_GAME, ...catalog];
  });
  const [loadingLive, setLoadingLive] = useState(true);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [background, setBackground] = useState<AppBackground>(() => {
    try { return JSON.parse(localStorage.getItem("frosted_background") || "null") || DEFAULT_BACKGROUND; } catch { return DEFAULT_BACKGROUND; }
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    // Automatically restore saved tab cloak on initial mount
    const saved = getSavedTabCloak();
    if (saved) {
      applyTabCloak(saved);
    }
  }, []);

  useEffect(() => {
    // Safety fallback timeout to ensure app is always accessible
    const safetyTimeout = window.setTimeout(() => setShowStartup(false), 6000);
    return () => window.clearTimeout(safetyTimeout);
  }, []);

  // Manage scrolling state on document body
  useEffect(() => {
    if (currentView === "chat" || currentView === "game") {
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    };
  }, [currentView]);

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);
  const [selectedTag, setSelectedTag] = useState("all");

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleTagChange = useCallback((tag: string) => {
    setSelectedTag(tag);
  }, []);

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
        const combined = deduplicateGames(baseList, luminPrepared).sort((a, b) => (a?.name || "").localeCompare(b?.name || ""));
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

  // Ensure URL is clean and without query params like ?game=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("game")) {
      params.delete("game");
      const cleanSearch = params.toString();
      const cleanUrl = window.location.pathname + (cleanSearch ? `?${cleanSearch}` : "") + window.location.hash;
      window.history.replaceState({}, "", cleanUrl);
    }
  }, []);

  const handleSelectGame = useCallback((game: Game) => {
    if (showStartup) return;
    setSelectedGame(game);
    setCurrentView("game");
  }, [showStartup]);

  const handleBackToHub = useCallback(() => {
    setSelectedGame(null);
    setCurrentView("home");
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
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
      <AnimatePresence mode="wait">
        {showStartup && (
          <LoadingScreen onComplete={() => setShowStartup(false)} />
        )}
      </AnimatePresence>
      <div id="app-root" className={`${(currentView === "game" && !isSoundboardActive) || currentView === "chat" ? "h-screen overflow-hidden" : "min-h-screen"} ${showStartup ? "pointer-events-none select-none" : ""} text-white antialiased font-sans flex flex-col selection:bg-white/20 selection:text-white`} style={{ background: background.type === "image" ? `url(${background.value}) center / cover fixed` : background.value }}>
      
      {/* Interactive Top Header Component */}
      <Header
        searchQuery={searchQuery}
        setSearchQuery={handleSearchChange}
        selectedTag={selectedTag}
        setSelectedTag={handleTagChange}
        tags={tags}
        onGoHome={handleBackToHub}
        onChatClick={handleOpenChat}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Main Content Area */}
      <main className={`flex-1 w-full flex flex-col relative ${isSoundboardActive ? "min-h-0 overflow-visible" : "min-h-0"}`}>
        
        {/* Game Player View */}
        <motion.div 
          animate={{
            opacity: (currentView === "game" && selectedGame) ? 1 : 0,
            y: (currentView === "game" && selectedGame) ? 0 : 16,
            scale: (currentView === "game" && selectedGame) ? 1 : 0.99,
          }}
          initial={{ opacity: 0, y: 16, scale: 0.99 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          style={{ 
            pointerEvents: (currentView === "game" && selectedGame) ? "auto" : "none",
            transform: "translateZ(0)"
          }}
          className={`flex-1 w-full flex flex-col ${isSoundboardActive ? "min-h-0 overflow-visible" : "min-h-0"} ${(currentView === "game" && selectedGame) ? "" : "absolute inset-x-0 top-0 invisible h-0 overflow-hidden"}`}
        >
          {selectedGame && (
            <GamePlayer
              game={selectedGame}
              onBack={handleBackToHub}
            />
          )}
        </motion.div>

        {/* Catalog Grid View */}
        <motion.div 
          animate={{
            opacity: currentView === "home" ? 1 : 0,
            y: currentView === "home" ? 0 : 16,
            scale: currentView === "home" ? 1 : 0.99,
          }}
          initial={{ opacity: 0, y: 0, scale: 1 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          style={{ 
            pointerEvents: currentView === "home" ? "auto" : "none",
            transform: "translateZ(0)"
          }}
          className={`w-full max-w-7xl mx-auto px-4 py-6 md:px-8 flex-1 flex flex-col gap-6 ${currentView === "home" ? "" : "absolute inset-x-0 top-0 invisible h-0 overflow-hidden"}`}
        >
          {/* Catalog Grid View */}
          <section id="games-catalog-section" className="flex-1 flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <h2 className="text-base font-bold tracking-wider uppercase text-white flex items-center gap-2.5">
                  <span>Games ({processedGames.length})</span>
                </h2>
                {loadingLive && (
                  <span className="text-[10px] text-indigo-300/60 font-semibold uppercase tracking-wider animate-pulse hidden sm:inline">
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
        </motion.div>

        {/* Discord Chat View */}
        <motion.div 
          animate={{
            opacity: currentView === "chat" ? 1 : 0,
            y: currentView === "chat" ? 0 : 16,
            scale: currentView === "chat" ? 1 : 0.99,
          }}
          initial={{ opacity: 0, y: 16, scale: 0.99 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          style={{ 
            pointerEvents: currentView === "chat" ? "auto" : "none",
            transform: "translateZ(0)"
          }}
          className={`flex-1 w-full flex flex-col min-h-0 ${currentView === "chat" ? "" : "absolute inset-x-0 top-0 invisible h-0 overflow-hidden"}`}
        >
          <Chat
            isOpen={currentView === "chat"}
            onClose={handleBackToHub}
            onOpenVoiceChat={() => setCurrentView("chat")}
            persistent
          />
        </motion.div>
      </main>

      {/* Footer Branding Area (Home view only) */}
      {currentView === "home" && (
        <footer id="app-footer" className="border-t border-indigo-950/40 bg-[#040616] px-4 py-6 md:px-8 text-center text-xs text-indigo-300/60">
          <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="font-medium text-neutral-300">
              &copy; 2026 FrostedStudying. Fast, unblocked browser games library.
            </p>
            <div className="flex flex-wrap gap-4 font-semibold text-indigo-300/80">
              <a href="https://discord.gg/D4c9VFYWyU" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
                Community
              </a>
              <span className="text-indigo-950">|</span>
              <a href="https://github.com/gn-math" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
                GN-Math
              </a>
            </div>
          </div>
        </footer>
      )}
  <BackgroundEditor background={background} onChange={setBackground} />
  <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
  
  </div>
  </>
  );
}
