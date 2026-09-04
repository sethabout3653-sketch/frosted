import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Game } from "../types";
import { formatGameUrl, getRawGameUrl, isFnfGame, isFnfMod } from "../utils";
import { getLuminGameUrl, embedLuminGame, closeLuminGame } from "../lumin";
import {
  ArrowLeft,
  Maximize2,
  RefreshCw,
  ExternalLink,
  RotateCcw,
  Mic,
} from "lucide-react";

interface GamePlayerProps {
  game: Game;
  onBack: () => void;
  onVoiceChat?: () => void;
}

type FitMode = "contain" | "fill" | "16-9" | "4-3";

export default function GamePlayer({ game, onBack, onVoiceChat }: GamePlayerProps) {
  const [gameUrl, setGameUrl] = useState<string>("");
  const [rawGameUrl, setRawGameUrl] = useState<string>("");
  const [usingDirectUrl, setUsingDirectUrl] = useState(false);
  const [gameLoadError, setGameLoadError] = useState(false);

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

  const isTheaterMode = false;

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Dynamic real-time container dimensions for automatic fit math
  const [containerDimensions, setContainerDimensions] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const isLuminGame = game.source === "luminsdk";
  const isGameMinusThree = game.name.trim() === "-3";
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

    if (fitMode === "fill" || isGameMinusThree) {
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
  }, [containerDimensions, fitMode, detectedRatio, isGameMinusThree]);

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
        // Catalog games use their direct HTTPS URL; Vercel deployments do not
        // expose the local Express proxy route.
        // Game -3 needs raw.githack's HTML serving path; keep every other
        // catalog game on the existing rawcdn.githack resolver.
        const catalogUrl = isGameMinusThree
          ? "https://raw.githack.com/gn-math/html/main/816.html"
          : formatGameUrl(game.url, false);
        const directRaw = catalogUrl;
        if (!isCancelled) {
          setGameUrl(catalogUrl);
          setRawGameUrl(directRaw);
          setUsingDirectUrl(false);
          setGameLoadError(false);
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

  <div className="ml-auto flex items-center gap-2">
  {onVoiceChat && (
    <button id="player-voice-btn" onClick={onVoiceChat} className="flex h-8 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 text-xs font-medium text-neutral-300 transition-all hover:bg-neutral-700 hover:text-white" title="Open voice chat">
      <Mic size={13} className="mr-0 sm:mr-1.5" /><span className="hidden sm:inline">Voice</span>
    </button>
  )}
  {rawGameUrl && (
            <button id="player-external-btn" onClick={handleOpenInNewTab} className="flex h-8 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-800 px-2 text-xs font-medium text-neutral-300 transition-all hover:bg-neutral-700 hover:text-white" title="Open game in a new tab">
              <ExternalLink size={14} />
            </button>
          )}
          <button id="player-reload-btn" onClick={handleReload} className="flex h-8 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 text-xs font-medium text-neutral-300 transition-all hover:bg-neutral-700 hover:text-white" title="Reload game">
            <RefreshCw size={13} className="mr-0 sm:mr-1.5" />
            <span className="hidden sm:inline">Reload</span>
          </button>
          <button id="player-fullscreen-btn" onClick={handleFullscreen} className="flex h-8 items-center justify-center rounded-lg bg-white px-3 text-xs font-bold text-black shadow-md transition-all hover:bg-neutral-200" title="Fullscreen">
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
          isTheaterMode || isGameMinusThree ? "max-w-none" : "max-w-6xl mx-auto"
        }`}
      >
        {/* Dynamic Auto-Fit Sizing & Scaling Wrapper */}
        <div
          className={`relative flex items-center justify-center transition-transform duration-150 ${isGameMinusThree ? "h-full w-full min-h-0 min-w-0" : ""}`}
          style={{
            ...sizingStyle,
            ...(isGameMinusThree ? { width: "100%", height: "100%", minHeight: 0, minWidth: 0 } : {}),
            transform: !isGameMinusThree && zoom !== 100 ? `scale(${zoom / 100})` : undefined,
            transformOrigin: "center center",
          }}
        >
          {/* Embedded Game iframe */}
          {gameUrl && !gameLoadError && (
            <iframe
              id="game-iframe"
              key={gameUrl}
              ref={iframeRef}
              src={gameUrl}
              onError={() => {
                if (!usingDirectUrl && rawGameUrl && rawGameUrl !== gameUrl) {
                  setUsingDirectUrl(true);
                  setGameUrl(rawGameUrl);
                } else {
                  setGameLoadError(true);
                }
              }}
              tabIndex={0}
              className="h-full w-full rounded-xl border-none bg-black"
              scrolling="yes"
              allow="autoplay; fullscreen; keyboard; gamepad; pointer-lock"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-pointer-lock allow-modals allow-orientation-lock"
            />
          )}
          {gameLoadError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950 p-6 text-center">
              <p className="text-sm font-semibold text-white">This game could not be embedded here.</p>
              <p className="max-w-md text-xs text-neutral-400">The game host returned a 404 or blocked embedding. Open the original game page instead.</p>
              <button onClick={handleOpenInNewTab} className="rounded-lg bg-white px-4 py-2 text-xs font-bold text-black hover:bg-neutral-200">Open original game</button>
              <button onClick={() => { setGameLoadError(false); setUsingDirectUrl(false); setGameUrl(formatGameUrl(game.url, true)); }} className="text-xs text-neutral-400 underline hover:text-white">Retry embed</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


