import { useState, useRef, useEffect, useCallback } from "react";
import { Game } from "../types";
import { formatGameUrl, isFnfGame, isFnfMod } from "../utils";
import { getLuminGameUrl, embedLuminGame, closeLuminGame } from "../lumin";
import {
  ArrowLeft,
  Maximize2,
  RefreshCw,
} from "lucide-react";

interface GamePlayerProps {
  game: Game;
  onBack: () => void;
}

export default function GamePlayer({
  game,
  onBack,
}: GamePlayerProps) {
  const [gameUrl, setGameUrl] = useState<string>("");
  const [isPointerLocked, setIsPointerLocked] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const isLuminGame = game.source === "luminsdk";
  const isMod = game.isMod ?? isFnfMod(game.name, game.special);
  const isFnf = isFnfGame(game.name, game.special);

  // Request Pointer Lock on container / iframe element
  const requestPointerLock = useCallback(() => {
    // Focus iframe so keyboard and mouse inputs route immediately to game
    if (iframeRef.current) {
      try {
        iframeRef.current.focus();
        iframeRef.current.contentWindow?.focus();
      } catch {}
    }

    const target = containerRef.current || iframeRef.current;
    if (target) {
      try {
        const promise = target.requestPointerLock?.();
        if (promise && typeof (promise as any).catch === "function") {
          (promise as any).catch((e: any) => {
            console.warn("Pointer lock request rejected:", e);
          });
        }
      } catch (err) {
        console.warn("Pointer lock error:", err);
      }
    }
  }, []);

  // Monitor Fullscreen changes globally to auto-focus and auto-lock the mouse for 3D games
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      );

      if (isCurrentlyFullscreen) {
        // Grant absolute focus to the game iframe
        if (iframeRef.current) {
          try {
            iframeRef.current.focus();
            iframeRef.current.contentWindow?.focus();
          } catch {}
        }

        // Delay pointer lock request slightly to let the browser transition finish
        setTimeout(() => {
          requestPointerLock();
        }, 300);
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
  }, [requestPointerLock]);

  // Exit Pointer Lock
  const exitPointerLock = useCallback(() => {
    if (document.pointerLockElement) {
      try {
        document.exitPointerLock();
      } catch (err) {
        console.warn("Exit pointer lock error:", err);
      }
    }
    setIsPointerLocked(false);
  }, []);

  // Synchronize pointer lock state with document and handle ESC key
  useEffect(() => {
    const handlePointerLockChange = () => {
      const currentLock =
        document.pointerLockElement === containerRef.current ||
        (iframeRef.current && document.pointerLockElement === iframeRef.current) ||
        !!document.pointerLockElement;
      setIsPointerLocked(!!currentLock);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.code === "Escape") {
        if (document.pointerLockElement) {
          try {
            document.exitPointerLock();
          } catch {}
        }
        setIsPointerLocked(false);
      }
    };

    document.addEventListener("pointerlockchange", handlePointerLockChange);
    document.addEventListener("mozpointerlockchange", handlePointerLockChange);
    document.addEventListener("webkitpointerlockchange", handlePointerLockChange);
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("pointerlockchange", handlePointerLockChange);
      document.removeEventListener("mozpointerlockchange", handlePointerLockChange);
      document.removeEventListener("webkitpointerlockchange", handlePointerLockChange);
      window.removeEventListener("keydown", handleKeyDown, true);
      if (document.pointerLockElement) {
        try {
          document.exitPointerLock();
        } catch {}
      }
    };
  }, []);

  // Initialize and load game normally
  useEffect(() => {
    let isCancelled = false;

    async function loadGame() {
      if (isLuminGame && game.luminId) {
        // Clean any previous Lumin instance
        closeLuminGame();

        // 1. First attempt to resolve direct playable game URL from Lumin
        const directUrl = await getLuminGameUrl(game.luminId);
        if (!isCancelled && directUrl) {
          setGameUrl(directUrl);
          return;
        }

        // 2. Fallback: Embed Lumin player directly into our container without window takeover
        if (!isCancelled && containerRef.current) {
          const frame = await embedLuminGame(containerRef.current, game.luminId);
          if (!isCancelled) {
            if (frame && frame.src) {
              setGameUrl(frame.src);
            }
          }
        }
      } else {
        // Catalog game: resolve formatGameUrl immediately
        const catalogUrl = formatGameUrl(game.url);
        if (!isCancelled) {
          setGameUrl(catalogUrl);
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
    exitPointerLock();
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
    // Also trigger pointer lock when entering fullscreen for 3D games
    requestPointerLock();
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

  return (
    <div id="game-player-wrapper" className="flex flex-col w-full h-[calc(100vh-5rem)] bg-black overflow-y-auto px-4 py-3 md:px-8">
      {/* Top Controls Action Bar */}
      <div id="player-action-bar" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            id="player-back-btn"
            onClick={handleBack}
            className="flex items-center justify-center h-10 px-4 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white font-medium text-sm transition-all border border-neutral-700 hover:border-neutral-600 cursor-pointer"
          >
            <ArrowLeft size={16} className="mr-2" />
            Back to Hub
          </button>
          
          <div className="h-6 w-[1px] bg-neutral-800 hidden sm:block"></div>

          <div>
            <h1 className="text-base md:text-lg font-bold text-white truncate max-w-[200px] sm:max-w-[400px]">
              {game.name}
            </h1>
            <p className="text-[11px] text-neutral-400 font-medium flex items-center gap-2">
              <span>{game.author ? `by ${game.author}` : "Classic"}</span>
              {isMod ? (
                <span className="px-1.5 py-0.5 rounded bg-white text-black font-bold text-[9px] uppercase tracking-wider">
                  FNF Mod
                </span>
              ) : isFnf ? (
                <span className="px-1.5 py-0.5 rounded bg-black/80 text-white border border-neutral-600 font-bold text-[9px] uppercase tracking-wider">
                  FNF
                </span>
              ) : null}
            </p>
          </div>
        </div>

        {/* Game Manipulation Buttons */}
        <div className="flex items-center gap-2">
          {/* Reload Button */}
          <button
            id="player-reload-btn"
            onClick={handleReload}
            className="flex items-center justify-center h-10 px-3 rounded-lg bg-neutral-800 border border-neutral-700 hover:bg-neutral-700 hover:border-neutral-600 text-neutral-300 text-sm font-medium transition-all cursor-pointer"
            title="Reload Game"
          >
            <RefreshCw size={16} className="mr-0 sm:mr-2" />
            <span className="hidden sm:inline">Reload</span>
          </button>

          {/* Fullscreen Button */}
          <button
            id="player-fullscreen-btn"
            onClick={handleFullscreen}
            className="flex items-center justify-center h-10 px-4 rounded-lg bg-white hover:bg-neutral-200 text-black text-sm font-bold shadow-md transition-all cursor-pointer"
            title="Fullscreen"
          >
            <Maximize2 size={16} className="mr-0 sm:mr-2" />
            <span className="hidden sm:inline">Fullscreen</span>
          </button>
        </div>
      </div>

      {/* Main Game Container */}
      <div
        id="player-frame-container"
        ref={containerRef}
        onClick={requestPointerLock}
        onMouseDown={requestPointerLock}
        className="relative flex-1 w-full flex items-center justify-center bg-black rounded-2xl border border-neutral-800 shadow-2xl transition-all duration-300 max-w-6xl mx-auto min-h-[70vh] mb-4 overflow-hidden"
      >
        {/* Embedded Game frame */}
        {gameUrl && (
          <iframe
            id="game-iframe"
            ref={iframeRef}
            src={gameUrl}
            tabIndex={0}
            className="w-full h-full rounded-2xl bg-black border-none"
            allow="autoplay; fullscreen; keyboard; gamepad; pointer-lock"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-pointer-lock allow-modals allow-orientation-lock"
          />
        )}
      </div>
    </div>
  );
}

