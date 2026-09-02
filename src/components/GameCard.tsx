import React, { memo } from "react";
import { Game } from "../types";
import { formatCoverUrl, formatTagLabel, isFnfGame, isFnfMod } from "../utils";
import { Gamepad2 } from "lucide-react";

interface GameCardProps {
  game: Game;
  onSelect: (game: Game) => void;
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
          className={`fallback-icon-container ${coverUrl ? "hidden" : "flex"} h-full w-full flex-col items-center justify-center bg-neutral-950 text-neutral-500`}
        >
          <Gamepad2 size={36} className="text-neutral-600" />
          <span className="mt-2 text-[10px] uppercase tracking-wider text-neutral-500 text-center px-2">
            No Cover Art
          </span>
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
