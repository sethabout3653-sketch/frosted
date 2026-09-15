import React, { useState, useEffect, useRef, useMemo, memo } from "react";
import { Game } from "../types";
import GameCard from "./GameCard";
import { Gamepad2, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface GameGridProps {
  games: Game[];
  onSelectGame: (game: Game) => void;
}

const ITEMS_PER_PAGE = 48;

const cardVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: [0.16, 1, 0.3, 1] as const, // snappier cubic-bezier
      delay: Math.min(index * 0.015, 0.35), // gentle cascading staggered loading
    },
  }),
};

const GameGrid = memo(function GameGrid({
  games,
  onSelectGame,
}: GameGridProps) {
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset pagination count whenever the games list changes (search or category filter)
  useEffect(() => {
    setVisibleCount(ITEMS_PER_PAGE);
  }, [games]);

  // Infinite scroll intersection observer: automatically loads the next chunk smoothly
  useEffect(() => {
    const target = sentinelRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => {
            if (prev < games.length) {
              return Math.min(prev + ITEMS_PER_PAGE, games.length);
            }
            return prev;
          });
        }
      },
      { rootMargin: "300px" }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [games.length]);

  const visibleGames = useMemo(
    () => games.slice(0, visibleCount),
    [games, visibleCount]
  );
  const hasMore = visibleCount < games.length;

  const handleLoadMore = () => {
    setVisibleCount((prev) => Math.min(prev + ITEMS_PER_PAGE, games.length));
  };

  // If search/filters yield zero results, render a sleek empty state with motion
  if (games.length === 0) {
    return (
      <motion.div
        id="grid-empty-state"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col items-center justify-center py-20 px-4 text-center"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.02] border border-white/5 text-neutral-400 mb-4 shadow-inner">
          <Gamepad2 size={28} className="text-indigo-400" />
        </div>
        <h3 className="text-base font-bold text-neutral-200">No Unblocked Games Found</h3>
        <p className="mt-1 text-xs text-neutral-500 max-w-xs leading-relaxed font-medium">
          We couldn't find any games matching your current search filters. Try clearing your filters or search keywords!
        </p>
      </motion.div>
    );
  }

  return (
    <div id="game-grid-container" className="flex flex-col gap-8">
      {/* Dynamic Grid Layout */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
        <AnimatePresence mode="popLayout">
          {visibleGames.map((game, index) => (
            <motion.div
              key={game.id}
              custom={index}
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              className="w-full h-full"
            >
              <GameCard
                game={game}
                onSelect={onSelectGame}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Sentinel for IntersectionObserver */}
      {hasMore && <div ref={sentinelRef} className="h-4 w-full pointer-events-none opacity-0" />}

      {/* Load More Button */}
      {hasMore && (
        <div className="flex justify-center pt-2 pb-8">
          <button
            id="load-more-btn"
            onClick={handleLoadMore}
            className="flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/20 px-6 py-3 border border-white/10 text-white font-semibold text-xs transition-all tracking-wider uppercase cursor-pointer shadow-md hover:scale-102 active:scale-98"
          >
            <span>Load More Games ({games.length - visibleCount} remaining)</span>
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
});

export default GameGrid;
