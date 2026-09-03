import { Game } from "./types";
import localZones from "./zones.json";

export const COVER_BASE = "https://raw.githubusercontent.com/gn-math/covers/main";
export const HTML_BASE = "https://rawcdn.githack.com/gn-math/html/main";
export const ASSETS_JSON_URL = "https://raw.githubusercontent.com/gn-math/assets/main/zones.json";

/**
 * Normalizes a game's cover URL by replacing placeholders with raw.githack URLs.
 */
export function formatCoverUrl(cover: string): string {
  if (!cover) return "";
  let url = cover;
  if (url.startsWith("http://")) url = url.replace("http://", "https://");
  
  if (url.startsWith("https://")) return url;
  
  return url
    .replace(/{COVER_URL}/g, COVER_BASE)
    .replace(/{HTML_URL}/g, HTML_BASE);
}

/**
 * Normalizes a game's play URL by replacing placeholders with raw.githack URLs.
 * When useProxy is true and the target is an HTML game, routes through /api/game-frame to inject auto-fit responsive styles.
 */
export function formatGameUrl(url: string, useProxy: boolean = true): string {
  if (!url) return "";
  let formattedUrl = url;
  if (formattedUrl.startsWith("http://")) formattedUrl = formattedUrl.replace("http://", "https://");

  const rawUrl = formattedUrl
    .replace(/{HTML_URL}/g, HTML_BASE)
    .replace(/{COVER_URL}/g, COVER_BASE);

  if (useProxy && (rawUrl.includes("rawcdn.githack.com") || rawUrl.endsWith(".html"))) {
    return `/api/game-frame?url=${encodeURIComponent(rawUrl)}`;
  }

  return rawUrl;
}

/**
 * Returns the raw direct URL without proxying (useful for opening in a dedicated new tab).
 */
export function getRawGameUrl(url: string): string {
  return formatGameUrl(url, false);
}

/**
 * Fetches the live game list (zones.json) from GitHub with a robust local fallback.
 */
export async function fetchGamesList(): Promise<Game[]> {
  try {
    const response = await fetch(`${ASSETS_JSON_URL}?t=${Date.now()}`);
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        return data as Game[];
      }
    }
  } catch {
    try {
      const localRes = await fetch(`/zones.json?t=${Date.now()}`);
      if (localRes.ok) {
        const localData = await localRes.json();
        if (Array.isArray(localData) && localData.length > 0) {
          return localData as Game[];
        }
      }
    } catch {
      // ignore
    }
  }
  return localZones as Game[];
}

/**
 * Extracts all unique tag keywords from the list of games.
 */
export function getUniqueTags(games: Game[]): string[] {
  const tagsSet = new Set<string>();
  games.forEach((game) => {
    if (Array.isArray(game.special)) {
      game.special.forEach((tag) => {
        if (tag && tag.trim().length > 0) {
          const cleanTag = tag.trim().toLowerCase();
          if (cleanTag !== "luminsdk") {
            tagsSet.add(cleanTag);
          }
        }
      });
    }
  });
  return Array.from(tagsSet).sort();
}

/**
 * Identifies specific Baldi target game groups ("Baldi's Basics", "Baldi's Basics Plus", "Baldi's Basics Classic Remastered")
 * that should prefer LuminSDK instead of gn-math catalog.
 */
export function getBaldiTargetGroup(name: string): string | null {
  const canon = name
    .toLowerCase()
    .trim()
    .replace(/['’":.-]/g, "")
    .replace(/\s+/g, "");

  if (canon === "baldibasics" || canon === "baldisbasics") {
    return "baldi_basics";
  }
  if (canon === "baldibasicsplus" || canon === "baldisbasicsplus") {
    return "baldi_basics_plus";
  }
  if (canon === "baldibasicsclassicremastered" || canon === "baldisbasicsclassicremastered") {
    return "baldi_basics_classic_remastered";
  }
  return null;
}

/**
 * Deduplicates games between the primary gn-math catalog and secondary sources (LuminSDK),
 * and eliminates duplicate copies within the catalog itself.
 * Specifically:
 * 1. For "Friday Night Funkin" / "FNF", the gn-math version is strictly preserved.
 * 2. For "Baldi's Basics", "Baldi's Basics Plus", and "Baldi's Basics Classic Remastered",
 *    the LuminSDK version is preferred over the gn-math catalog version.
 */
export function deduplicateGames(catalogGames: Game[], luminGames: Game[]): Game[] {
  const seenCanonical = new Set<string>();
  const result: Game[] = [];

  const getCanonical = (name: string) =>
    name
      .toLowerCase()
      .trim()
      .replace(/['’":.-]/g, "")
      .replace(/\s+/g, " ");

  // Identify which Baldi target groups are present in LuminSDK
  const luminBaldiGroups = new Set<string>();
  for (const lg of luminGames) {
    if (lg.id === -1) continue;
    const group = getBaldiTargetGroup(lg.name);
    if (group) {
      luminBaldiGroups.add(group);
    }
  }

  // 1. Process primary gn-math catalog games
  for (const game of catalogGames) {
    if (game.id === -1) continue;
    const canon = getCanonical(game.name);

    // If this catalog game is a Baldi target game that exists in LuminSDK, skip catalog version
    const baldiGroup = getBaldiTargetGroup(game.name);
    if (baldiGroup && luminBaldiGroups.has(baldiGroup)) {
      continue;
    }

    if (!seenCanonical.has(canon)) {
      seenCanonical.add(canon);
      result.push(game);
    }
  }

  // 2. Add secondary LuminSDK games
  for (const game of luminGames) {
    if (game.id === -1) continue;
    const canon = getCanonical(game.name);

    // Explicitly delete Lumin's duplicate copy of Friday Night Funkin / FNF
    if (canon === "friday night funkin" || canon === "fnf") {
      continue;
    }

    // Discard any Lumin game that duplicates a catalog game (unless it's a target Baldi game that was skipped)
    if (seenCanonical.has(canon)) {
      continue;
    }

    seenCanonical.add(canon);
    result.push(game);
  }

  return result;
}

/**
 * Checks if a game belongs to the FNF (Friday Night Funkin') ecosystem or mod catalog.
 */
export function isFnfGame(name: string, special?: string[]): boolean {
  const lower = name.toLowerCase();
  if (
    lower.includes("friday night funkin") ||
    lower.includes("funkin") ||
    /\bfnf\b/i.test(name) ||
    lower.startsWith("fnf") ||
    (special && special.some((s) => s.toLowerCase() === "fnf" || s.toLowerCase() === "fnf-mod"))
  ) {
    return true;
  }
  return false;
}

/**
 * Checks if an FNF game is a mod rather than the original vanilla base game.
 * Recognizes "Friday Night Funkin", "FNF", "FNF, Friday Night Funkin", "Friday Night Funkin, FNF",
 * and all vanilla title variations as the original game (returns false for isMod).
 */
export function isFnfMod(name: string, special?: string[]): boolean {
  if (!isFnfGame(name, special)) return false;

  const clean = name
    .toLowerCase()
    .replace(/['’":.-]/g, "")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Known vanilla base game patterns
  const vanillaPatterns = [
    /^friday night funkin$/,
    /^fnf$/,
    /^fnf friday night funkin$/,
    /^friday night funkin fnf$/,
    /^fnf \(?original\)?$/,
    /^friday night funkin \(?original\)?$/,
    /^the original friday night funkin$/,
    /^original friday night funkin$/,
    /^original fnf$/,
    /^friday night funkin vanilla$/,
    /^fnf vanilla$/,
  ];

  if (vanillaPatterns.some((pattern) => pattern.test(clean))) {
    return false;
  }

  // Check if title consists only of vanilla keywords without mod-specific indicators
  const tokens = clean.split(" ").filter(Boolean);
  const isOnlyVanillaTokens =
    tokens.length > 0 &&
    tokens.every(
      (t) =>
        t === "fnf" ||
        t === "friday" ||
        t === "night" ||
        t === "funkin" ||
        t === "original" ||
        t === "vanilla" ||
        t === "the" ||
        t === "game"
    );

  const hasModKeywords =
    clean.includes("vs") ||
    clean.includes("v.s") ||
    clean.includes("mod") ||
    clean.includes("sides") ||
    clean.includes("remix") ||
    clean.includes("soft") ||
    clean.includes("neo") ||
    clean.includes("pibby") ||
    clean.includes("corrupted") ||
    clean.includes("minus") ||
    clean.includes("edition") ||
    clean.includes("b-side") ||
    clean.includes("d-side");

  if (isOnlyVanillaTokens && !hasModKeywords) {
    return false;
  }

  return true;
}

/**
 * Capitalizes tags for cleaner presentation.
 */
export function formatTagLabel(tag: string): string {
  const lower = tag.toLowerCase().trim();
  if (lower === "fnf") return "FNF";
  if (lower === "fnf-mod" || lower === "fnf mod") return "FNF Mod";
  if (lower === "gba") return "GBA";
  if (lower === "nds") return "NDS";
  if (lower === "n64") return "N64";
  if (lower === "nes") return "NES";
  if (lower === "psx") return "PSX";
  if (lower === "dos") return "DOS";
  return tag
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
