import React, { memo } from "react";
import { Game } from "../types";
import { formatCoverUrl, formatTagLabel, isFnfGame, isFnfMod } from "../utils";
import { Gamepad2 } from "lucide-react";

interface GameCardProps {
  game: Game;
  onSelect: (game: Game) => void;
}

const PRESET_GRADIENTS = [
  "from-indigo-600 via-indigo-700 to-violet-800",
  "from-cyan-600 via-teal-700 to-emerald-800",
  "from-rose-500 via-pink-600 to-purple-700",
  "from-amber-500 via-orange-600 to-rose-700",
  "from-blue-600 via-blue-700 to-indigo-800",
  "from-purple-600 via-fuchsia-700 to-pink-800",
  "from-emerald-500 via-teal-600 to-cyan-700",
  "from-violet-600 via-purple-700 to-indigo-800"
];

function getGameGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % PRESET_GRADIENTS.length;
  return PRESET_GRADIENTS[index];
}

function getGameInitials(name: string): string {
  const cleanName = name.replace(/[^a-zA-Z0-9\s]/g, "").trim();
  const words = cleanName.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "G";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const GameCard = memo(function GameCard({
  game,
  onSelect,
}: GameCardProps) {
  // Filter out suggestions or non-playable elements
  if (game.id === -1) return null;

  const isMod = game.isMod ?? isFnfMod(game.name, game.special);
  const isFnf = isFnfGame(game.name, game.special);

  const coverUrl = formatCoverUrl(game.cover);
  // Avoid duplicating FNF or FNF-mod in secondary tags since the primary badge handles it
  const rawTags = game.special
    ? game.special.filter((t) => {
        const clean = t.toLowerCase();
        if (clean === "luminsdk" || clean === "fnf" || clean === "fnf-mod") return false;
        return true;
      })
    : [];

  const tagsToShow = rawTags.slice(0, 2);
  const gradientClass = getGameGradient(game.name);
  const initials = getGameInitials(game.name);

  return (
    <div
      id={`game-card-${game.id}`}
      onClick={() => onSelect(game)}
      className="game-card-item group relative cursor-pointer overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/60 p-2 text-left shadow-md transition-all duration-150 ease-out hover:-translate-y-1 hover:border-neutral-500 hover:bg-neutral-900 hover:shadow-lg hover:shadow-white/5 active:scale-[0.98]"
    >
      {/* Cover Image Container */}
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-black">
        {coverUrl ? (
          <img
            id={`game-cover-img-${game.id}`}
            src={coverUrl}
            alt={game.name}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              
              // If the local proxy failed, try direct CDN fallback first
              if (target.src.includes("/api/lumin-icon/")) {
                const parts = target.src.split("/api/lumin-icon/");
                const token = parts[parts.length - 1];
                if (token) {
                  target.src = `https://a.luminsdk.com/api/v1/icon/${token}`;
                  return;
                }
              }

              target.style.display = "none";
              const parent = target.parentElement;
              if (parent) {
                const fallback = parent.querySelector(".fallback-icon-container");
                if (fallback) {
                  fallback.classList.remove("hidden");
                  fallback.classList.add("flex");
                }
              }
            }}
          />
        ) : null}

        {/* Fallback Icon Container */}
        <div
          id={`fallback-container-${game.id}`}
          className={`fallback-icon-container ${coverUrl ? "hidden" : "flex"} h-full w-full flex-col items-center justify-center bg-gradient-to-br ${gradientClass} relative overflow-hidden`}
        >
          {/* Subtle background glow/noise simulation */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(255,255,255,0.15),transparent)] pointer-events-none" />
          
          {/* Big initials backdrop */}
          <span className="absolute text-white/10 font-black text-6xl sm:text-7xl select-none uppercase tracking-tighter transform -translate-y-2">
            {initials}
          </span>

          {/* Central floating icon */}
          <div className="relative z-10 flex flex-col items-center justify-center">
            <Gamepad2 size={38} className="text-white/90 drop-shadow-[0_2px_8px_rgba(0,0,0,0.4)] animate-pulse" />
            <span className="mt-2.5 text-[9px] uppercase tracking-widest font-extrabold text-white/95 drop-shadow-sm px-2.5 py-0.5 rounded-full bg-black/25 backdrop-blur-sm border border-white/10">
              PLAY
            </span>
          </div>
        </div>

        {/* Tags Overlay */}
        <div className="absolute bottom-2 left-2 z-10 flex flex-wrap gap-1">
          {isMod ? (
            <span className="rounded-md bg-white text-black px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider shadow-sm">
              FNF Mod
            </span>
          ) : isFnf ? (
            <span className="rounded-md bg-black/80 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white backdrop-blur-md border border-neutral-600">
              FNF
            </span>
          ) : null}

          {tagsToShow.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-black/80 px-1.5 py-0.5 text-[9px] font-medium text-neutral-300 backdrop-blur-md border border-neutral-700/60"
            >
              {formatTagLabel(tag)}
            </span>
          ))}
        </div>
      </div>

      {/* Meta Text */}
      <div className="mt-2 px-1">
        <h3 className="truncate text-sm font-semibold tracking-wide text-neutral-200 group-hover:text-white">
          {game.name}
        </h3>
        {game.author ? (
          <p className="mt-0.5 truncate text-[11px] text-neutral-400 font-medium">
            {game.author}
          </p>
        ) : (
          <p className="mt-0.5 truncate text-[11px] text-neutral-500 font-medium">
            {isMod ? "FNF Mod" : isFnf ? "FNF" : tagsToShow.length > 0 ? formatTagLabel(tagsToShow[0]) : "Web"}
          </p>
        )}
      </div>
    </div>
  );
});

export default GameCard;
