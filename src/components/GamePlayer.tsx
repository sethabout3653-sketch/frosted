import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Game } from "../types";
import { formatGameUrl, getRawGameUrl, isFnfGame, isFnfMod } from "../utils";
import { getLuminGameUrl, embedLuminGame, closeLuminGame } from "../lumin";
import {
  ArrowLeft,
  Maximize2,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  ExternalLink,
  Tv,
  RotateCcw,
} from "lucide-react";

interface GamePlayerProps {
  game: Game;
  onBack: () => void;
}

type FitMode = "contain" | "fill" | "16-9" | "4-3";

export default function GamePlayer({ game, onBack }: GamePlayerProps) {
  const [gameUrl, setGameUrl] = useState<string>("");
  const [rawGameUrl, setRawGameUrl] = useState<string>("");

  // Load preferences from localStorage or default to automatic optimal fit
  const [fitMode, setFitMode] = useState<FitMode>(() => {
    try {
      const saved = localStorage.getItem("frosted_fit_mode");
      if (saved === "contain" || saved === "fill" || saved === "16-9" || saved === "4-3") {
        return saved;
      }
    } catch {}
    return "contain";
  });

  const [zoom, setZoom] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("frosted_game_zoom");
      if (saved) {
        const val = parseInt(saved, 10);
        if (!isNaN(val) && val >= 50 && val <= 150) return val;
      }
    } catch {}
    return 100;
  });

  const [isTheaterMode, setIsTheaterMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("frosted_theater_mode");
      return saved === "true";
    } catch {}
    return false;
  });

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Dynamic real-time container dimensions for automatic fit math
  const [containerDimensions, setContainerDimensions] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const isLuminGame = game.source === "luminsdk";
  const isMod = game.isMod ?? isFnfMod(game.name, game.special);
  const isFnf = isFnfGame(game.name, game.special);

  // Automatically detect the game's natural aspect ratio based on title, type, and source
  const detectedRatio = useMemo(() => {
    if (isFnf || isMod) return 16 / 9;
    const nameLower = (game.name || "").toLowerCase();
    // Baldi's Basics classic is 4:3
    if (
      nameLower.includes("baldi") &&
      !nameLower.includes("remaster") &&
      !nameLower.includes("plus")
    ) {
      return 4 / 3;
    }
    // Retro emulators and arcade classics
    if (
      nameLower.includes("retro") ||
      nameLower.includes("arcade") ||
      nameLower.includes("mario") ||
      nameLower.includes("sonic") ||
      nameLower.includes("nes") ||
      nameLower.includes("snes") ||
      nameLower.includes("gba") ||
      nameLower.includes("pacman")
    ) {
      return 4 / 3;
    }
    // Default modern WebGL/HTML5 games to widescreen 16:9
    return 16 / 9;
  }, [game.name, isFnf, isMod]);

  // Keep track of container bounds automatically with ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateDims = () => {
      if (el) {
        setContainerDimensions({
          width: el.clientWidth,
          height: el.clientHeight,
        });
      }
    };

    updateDims();
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect) {
          setContainerDimensions({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        }
      }
    });

    observer.observe(el);
    window.addEventListener("resize", updateDims);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateDims);
    };
  }, []);

  // Compute exact sizing style so game automatically fits container without clipping
  const sizingStyle = useMemo(() => {
    const { width: cW, height: cH } = containerDimensions;

    if (fitMode === "fill") {
      return { width: "100%", height: "100%" };
    }

    if (cW <= 0 || cH <= 0) {
      return { width: "100%", height: "100%" };
    }

    let targetRatio = detectedRatio;
    if (fitMode === "16-9") {
      targetRatio = 16 / 9;
    } else if (fitMode === "4-3") {
      targetRatio = 4 / 3;
    }

    const containerRatio = cW / cH;
    let targetW: number;
    let targetH: number;

    if (containerRatio > targetRatio) {
      // Container is wider than the target aspect: height limits size
      targetH = cH;
      targetW = Math.round(cH * targetRatio);
    } else {
      // Container is taller than target aspect: width limits size
      targetW = cW;
      targetH = Math.round(cW / targetRatio);
    }

    return {
      width: `${targetW}px`,
      height: `${targetH}px`,
      maxWidth: "100%",
      maxHeight: "100%",
    };
  }, [containerDimensions, fitMode, detectedRatio]);

  // Focus iframe so keyboard and mouse inputs route immediately to game
  const focusGame = useCallback(() => {
    if (iframeRef.current) {
      try {
        iframeRef.current.focus();
        iframeRef.current.contentWindow?.focus();
      } catch {}
    }
  }, []);

  // Monitor Fullscreen changes globally to auto-focus the game iframe
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      );

      if (isCurrentlyFullscreen) {
        setTimeout(() => {
          focusGame();
        }, 150);
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);
    document.addEventListener("MSFullscreenChange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange);
      document.removeEventListener("MSFullscreenChange", handleFullscreenChange);
    };
  }, [focusGame]);

  // Initialize and load game normally
  useEffect(() => {
    let isCancelled = false;

    async function loadGame() {
      if (isLuminGame && game.luminId) {
        closeLuminGame();

        // 1. First attempt to resolve direct playable game URL from Lumin
        const directUrl = await getLuminGameUrl(game.luminId);
        if (!isCancelled && directUrl) {
          setGameUrl(directUrl);
          setRawGameUrl(directUrl);
          return;
        }

        // 2. Fallback: Embed Lumin player directly into container
        if (!isCancelled && containerRef.current) {
          const frame = await embedLuminGame(containerRef.current, game.luminId);
          if (!isCancelled && frame && frame.src) {
            setGameUrl(frame.src);
            setRawGameUrl(frame.src);
          }
        }
      } else {
        // Catalog game: resolve formatGameUrl with auto-fit proxy engine enabled
        const catalogUrl = formatGameUrl(game.url, true);
        const directRaw = getRawGameUrl(game.url);
        if (!isCancelled) {
          setGameUrl(catalogUrl);
          setRawGameUrl(directRaw);
        }
      }
    }

    loadGame();

    return () => {
      isCancelled = true;
      if (isLuminGame) {
        closeLuminGame();
      }
    };
  }, [game, isLuminGame]);

  const handleBack = () => {
    if (isLuminGame) {
      closeLuminGame();
    }
    onBack();
  };

  const handleFullscreen = () => {
    const target = containerRef.current || iframeRef.current;
    if (target) {
      if (target.requestFullscreen) {
        target.requestFullscreen();
      } else if ((target as any).webkitRequestFullscreen) {
        (target as any).webkitRequestFullscreen();
      } else if ((target as any).mozRequestFullScreen) {
        (target as any).mozRequestFullScreen();
      } else if ((target as any).msRequestFullscreen) {
        (target as any).msRequestFullscreen();
      }
    }
    focusGame();
  };

  const handleReload = () => {
    if (isLuminGame && game.luminId) {
      if (gameUrl && iframeRef.current) {
        iframeRef.current.src = gameUrl;
      } else if (containerRef.current) {
        closeLuminGame();
        embedLuminGame(containerRef.current, game.luminId);
      }
    } else if (iframeRef.current && gameUrl) {
      iframeRef.current.src = gameUrl;
    }
  };

  const handleZoomOut = () => {
    setZoom((prev) => {
      const next = Math.max(50, prev - 10);
      try {
        localStorage.setItem("frosted_game_zoom", next.toString());
      } catch {}
      return next;
    });
  };

  const handleZoomIn = () => {
    setZoom((prev) => {
      const next = Math.min(150, prev + 10);
      try {
        localStorage.setItem("frosted_game_zoom", next.toString());
      } catch {}
      return next;
    });
  };

  const handleResetZoom = () => {
    setZoom(100);
    try {
      localStorage.setItem("frosted_game_zoom", "100");
    } catch {}
  };

  const handleSetFitMode = (mode: FitMode) => {
    setFitMode(mode);
    try {
      localStorage.setItem("frosted_fit_mode", mode);
    } catch {}
  };

  const handleToggleTheater = () => {
    setIsTheaterMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("frosted_theater_mode", next.toString());
      } catch {}
      return next;
    });
  };

  const handleOpenInNewTab = () => {
    const targetUrl = rawGameUrl || gameUrl;
    if (targetUrl) {
      window.open(targetUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div
      id="game-player-wrapper"
      className={`flex flex-col w-full h-[calc(100vh-5rem)] bg-black overflow-hidden transition-all duration-300 ${
        isTheaterMode ? "p-2" : "px-3 py-2 md:px-6"
      }`}
    >
      {/* Top Controls Action Bar */}
      <div
        id="player-action-bar"
        className="flex flex-wrap items-center justify-between gap-2.5 mb-2.5 rounded-xl border border-neutral-800/90 bg-[#0c0c0c] px-3.5 py-2 backdrop-blur-md flex-shrink-0"
      >
        <div className="flex items-center gap-3">
          <button
            id="player-back-btn"
            onClick={handleBack}
            className="flex items-center justify-center h-8 px-3 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white font-medium text-xs transition-all border border-neutral-700/80 hover:border-neutral-600 cursor-pointer"
          >
            <ArrowLeft size={14} className="mr-1.5" />
            Back
          </button>

          <div className="h-5 w-[1px] bg-neutral-800 hidden sm:block"></div>

          <div>
            <h1 className="text-sm md:text-base font-bold text-white truncate max-w-[150px] sm:max-w-[280px] md:max-w-[400px]">
              {game.name}
            </h1>
            <p className="text-[10px] text-neutral-400 font-medium flex items-center gap-1.5">
              <span>{game.author ? `by ${game.author}` : "Classic"}</span>
              {isMod ? (
                <span className="px-1.5 py-0.2 rounded bg-white text-black font-bold text-[8px] uppercase tracking-wider">
                  FNF Mod
                </span>
              ) : isFnf ? (
                <span className="px-1.5 py-0.2 rounded bg-black text-white border border-neutral-600 font-bold text-[8px] uppercase tracking-wider">
                  FNF
                </span>
              ) : null}
            </p>
          </div>
        </div>

        {/* Game Manipulation & Fit Controls (DO NOT DELETE - KEPT AS IN IMAGE) */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap ml-auto">
          {/* Fit Mode Switcher */}
          <div className="flex items-center bg-neutral-900 border border-neutral-800 rounded-lg p-0.5">
            <button
              onClick={() => handleSetFitMode("contain")}
              className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all cursor-pointer ${
                fitMode === "contain"
                  ? "bg-neutral-700 text-white shadow-sm"
                  : "text-neutral-400 hover:text-white"
              }`}
              title="Automatically fit game on screen maintaining optimal aspect ratio"
            >
              Fit
            </button>
            <button
              onClick={() => handleSetFitMode("fill")}
              className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all cursor-pointer ${
                fitMode === "fill"
                  ? "bg-neutral-700 text-white shadow-sm"
                  : "text-neutral-400 hover:text-white"
              }`}
              title="Stretch to fill entire frame"
            >
              Fill
            </button>
            <button
              onClick={() => handleSetFitMode("16-9")}
              className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all cursor-pointer hidden md:block ${
                fitMode === "16-9"
                  ? "bg-neutral-700 text-white shadow-sm"
                  : "text-neutral-400 hover:text-white"
              }`}
              title="Lock 16:9 widescreen ratio"
            >
              16:9
            </button>
            <button
              onClick={() => handleSetFitMode("4-3")}
              className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all cursor-pointer hidden md:block ${
                fitMode === "4-3"
                  ? "bg-neutral-700 text-white shadow-sm"
                  : "text-neutral-400 hover:text-white"
              }`}
              title="Lock 4:3 classic ratio"
            >
              4:3
            </button>
          </div>

          {/* Zoom / Scale Controls */}
          <div className="flex items-center bg-neutral-900 border border-neutral-800 rounded-lg p-0.5">
            <button
              onClick={handleZoomOut}
              className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
              title="Zoom out game (reduce scale)"
            >
              <ZoomOut size={13} />
            </button>
            <button
              onClick={handleResetZoom}
              className="px-1.5 text-[10px] font-bold text-neutral-300 hover:text-white min-w-[34px] text-center cursor-pointer"
              title="Click to reset zoom to 100%"
            >
              {zoom}%
            </button>
            <button
              onClick={handleZoomIn}
              className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
              title="Zoom in game (increase scale)"
            >
              <ZoomIn size={13} />
            </button>
          </div>

          {/* Theater Mode Toggle */}
          <button
            id="player-theater-btn"
            onClick={handleToggleTheater}
            className={`flex items-center justify-center h-8 px-2.5 rounded-lg border text-xs font-medium transition-all cursor-pointer ${
              isTheaterMode
                ? "bg-white text-black border-white shadow"
                : "bg-neutral-800 border-neutral-700 hover:bg-neutral-700 text-neutral-300 hover:text-white"
            }`}
            title={isTheaterMode ? "Exit Theater Mode" : "Theater Mode (Wide)"}
          >
            <Tv size={14} className="mr-0 sm:mr-1.5" />
            <span className="hidden sm:inline">
              {isTheaterMode ? "Wide On" : "Theater"}
            </span>
          </button>

          {/* Open in New Tab Button */}
          {rawGameUrl && (
            <button
              id="player-external-btn"
              onClick={handleOpenInNewTab}
              className="flex items-center justify-center h-8 px-2 rounded-lg bg-neutral-800 border border-neutral-700 hover:bg-neutral-700 text-neutral-300 hover:text-white text-xs font-medium transition-all cursor-pointer"
              title="Open raw game in dedicated new tab"
            >
              <ExternalLink size={14} />
            </button>
          )}

          {/* Reload Button */}
          <button
            id="player-reload-btn"
            onClick={handleReload}
            className="flex items-center justify-center h-8 px-2.5 rounded-lg bg-neutral-800 border border-neutral-700 hover:bg-neutral-700 text-neutral-300 hover:text-white text-xs font-medium transition-all cursor-pointer"
            title="Reload Game"
          >
            <RefreshCw size={13} className="mr-0 sm:mr-1.5" />
            <span className="hidden sm:inline">Reload</span>
          </button>

          {/* Fullscreen Button */}
          <button
            id="player-fullscreen-btn"
            onClick={handleFullscreen}
            className="flex items-center justify-center h-8 px-3 rounded-lg bg-white hover:bg-neutral-200 text-black text-xs font-bold shadow-md transition-all cursor-pointer"
            title="Fullscreen"
          >
            <Maximize2 size={13} className="mr-0 sm:mr-1.5" />
            <span className="hidden sm:inline">Fullscreen</span>
          </button>
        </div>
      </div>

      {/* Main Game Frame Container */}
      <div
        id="player-frame-container"
        ref={containerRef}
        onClick={focusGame}
        onMouseDown={focusGame}
        className={`relative flex-1 w-full flex items-center justify-center bg-black rounded-2xl border border-neutral-800/90 shadow-2xl transition-all duration-300 min-h-0 overflow-hidden ${
          isTheaterMode ? "max-w-none" : "max-w-6xl mx-auto"
        }`}
      >
        {/* Dynamic Auto-Fit Sizing & Scaling Wrapper */}
        <div
          className="relative flex items-center justify-center transition-transform duration-150"
          style={{
            ...sizingStyle,
            transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined,
            transformOrigin: "center center",
          }}
        >
          {/* Embedded Game iframe */}
          {gameUrl && (
            <iframe
              id="game-iframe"
              ref={iframeRef}
              src={gameUrl}
              tabIndex={0}
              className="w-full h-full rounded-xl bg-black border-none"
              allow="autoplay; fullscreen; keyboard; gamepad; pointer-lock"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-pointer-lock allow-modals allow-orientation-lock"
            />
          )}
        </div>
      </div>
    </div>
  );
}


