import React, { memo, useMemo, useState } from "react";
import { Gamepad2 } from "lucide-react";
import { formatCoverUrl } from "../utils";

const PRESET_GRADIENTS = [
  "from-indigo-600 via-indigo-700 to-violet-800",
  "from-cyan-600 via-teal-700 to-emerald-800",
  "from-rose-500 via-pink-600 to-purple-700",
  "from-amber-500 via-orange-600 to-rose-700",
  "from-blue-600 via-blue-700 to-indigo-800",
  "from-purple-600 via-fuchsia-700 to-pink-800",
];

function fallbackClass(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return PRESET_GRADIENTS[Math.abs(hash) % PRESET_GRADIENTS.length];
}

function initials(name: string) {
  const words = name.replace(/[^a-zA-Z0-9\s]/g, "").trim().split(/\s+/).filter(Boolean);
  return words.length > 1 ? `${words[0][0]}${words[1][0]}`.toUpperCase() : (words[0]?.slice(0, 2) || "G").toUpperCase();
}

export const getCoverSources = (cover: string) => {
  const source = formatCoverUrl(cover);
  if (!source) return [];
  const sources = [source];
  if (source.includes("raw.githubusercontent.com/")) {
    const path = source.replace("https://raw.githubusercontent.com/", "");
    const [owner, repo, branch, ...rest] = path.split("/");
    sources.push(`https://raw.githack.com/${owner}/${repo}/${branch}/${rest.join("/")}`);
    sources.push(`https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${rest.join("/")}`);
    sources.push(`https://images.weserv.nl/?url=${encodeURIComponent(source)}`);
  }
  return [...new Set(sources)];
};

interface GameCoverProps {
  name: string;
  cover: string;
  className?: string;
}

const GameCover = memo(function GameCover({ name, cover, className = "" }: GameCoverProps) {
  const sources = useMemo(() => getCoverSources(cover), [cover]);
  const [index, setIndex] = useState(0);
  const failed = index >= sources.length;

  return (
    <div className={`relative h-full w-full overflow-hidden bg-gradient-to-br ${fallbackClass(name)} ${className}`}>
      {!failed && (
        <img
          src={sources[index]}
          alt={`${name} cover`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          onError={() => setIndex((value) => value + 1)}
        />
      )}
      {failed && <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="absolute text-6xl font-black tracking-tighter text-white/10">{initials(name)}</span><Gamepad2 className="relative text-white/90" size={38} /><span className="relative mt-2 rounded-full bg-black/25 px-2.5 py-0.5 text-[9px] font-extrabold tracking-widest text-white/95">PLAY</span></div>}
    </div>
  );
});

export default GameCover;
