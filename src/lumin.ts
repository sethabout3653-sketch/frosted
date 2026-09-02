import { Game } from "./types";
import { isFnfGame, isFnfMod } from "./utils";
import localLuminRaw from "./lumin-games.json";

declare global {
  interface Window {
    Lumin?: {
      init: (options: { container: string | HTMLElement; [key: string]: any }) => Promise<void>;
      getGames: () => Promise<Array<{ id: string; name: string; image_token?: string }>>;
      getCategories?: () => Promise<any>;
      getGameUrl?: (id: string) => Promise<string>;
      loadGame?: (id: string) => Promise<void>;
      closeGame?: () => void;
      destroy?: () => void;
    };
  }
}

const LUMIN_API_BASE = "https://a.luminsdk.com";
let luminInitPromise: Promise<boolean> | null = null;

/**
 * Initializes the LuminSDK script in headless mode using a detached/hidden container.
 * This ensures LuminSDK's games are accessible via its API without injecting any of
 * Lumin's default UI, styles, or header elements into the application.
 */
export async function initLuminHeadless(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (luminInitPromise) return luminInitPromise;

  luminInitPromise = (async () => {
    try {
      // Ensure hidden container exists in the DOM
      let hiddenContainer = document.getElementById("lumin-headless-container");
      if (!hiddenContainer) {
        hiddenContainer = document.createElement("div");
        hiddenContainer.id = "lumin-headless-container";
        hiddenContainer.style.display = "none";
        hiddenContainer.style.visibility = "hidden";
        hiddenContainer.style.position = "fixed";
        hiddenContainer.style.top = "-9999px";
        hiddenContainer.style.left = "-9999px";
        hiddenContainer.style.width = "0px";
        hiddenContainer.style.height = "0px";
        hiddenContainer.style.pointerEvents = "none";
        document.body.appendChild(hiddenContainer);
      }

      // Check if window.Lumin is loaded; if not, dynamically load the official script
      if (!window.Lumin) {
        await new Promise<void>((resolve, reject) => {
          const existingScript = document.querySelector('script[src*="lumin"]');
          if (existingScript) {
            existingScript.addEventListener("load", () => resolve());
            existingScript.addEventListener("error", () => resolve());
            // timeout fallback
            setTimeout(resolve, 2000);
            return;
          }

          const script = document.createElement("script");
          script.src = "https://cdn.jsdelivr.net/gh/luminsdk/script@latest/lumin.min.js";
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => resolve();
          document.head.appendChild(script);
          setTimeout(resolve, 3000);
        });
      }

      if (window.Lumin && typeof window.Lumin.init === "function") {
        await window.Lumin.init({
          container: "#lumin-headless-container",
        });
        return true;
      }
      return false;
    } catch (err) {
      console.warn("LuminSDK headless init notice:", err);
      return false;
    }
  })();

  return luminInitPromise;
}

/**
 * Derives genre / category tags from a game's name or id
 */
function inferLuminTags(name: string, id: string): string[] {
  const tags: string[] = [];
  const lower = (name + " " + id).toLowerCase();

  if (isFnfGame(name)) {
    if (isFnfMod(name)) {
      tags.push("fnf-mod");
    } else {
      tags.push("fnf");
    }
  }
  if (lower.includes("mario") || lower.includes("sonic") || lower.includes("pokemon") || lower.includes("zelda") || lower.includes("retro") || lower.includes("arcade")) {
    tags.push("retro");
  }
  if (lower.includes("racing") || lower.includes("drive") || lower.includes("car") || lower.includes("drift") || lower.includes("bike") || lower.includes("moto")) {
    tags.push("driving");
  }
  if (lower.includes("shooter") || lower.includes("gun") || lower.includes("quake") || lower.includes("doom") || lower.includes("strike") || lower.includes("war")) {
    tags.push("shooting");
  }
  if (lower.includes("puzzle") || lower.includes("2048") || lower.includes("chess") || lower.includes("sudoku") || lower.includes("tetris") || lower.includes("brain")) {
    tags.push("puzzle");
  }
  if (lower.includes("action") || lower.includes("fight") || lower.includes("smash") || lower.includes("battle") || lower.includes("ninja") || lower.includes("runner")) {
    tags.push("action");
  }
  if (lower.includes("multiplayer") || lower.includes(".io") || lower.includes("pvp") || lower.includes("party")) {
    tags.push("multiplayer");
  }
  if (lower.includes("sports") || lower.includes("soccer") || lower.includes("football") || lower.includes("basketball") || lower.includes("golf")) {
    tags.push("sports");
  }
  if (tags.length === 0) {
    tags.push("arcade");
  }
  return tags;
}

/**
 * Returns the bundled snapshot of LuminSDK games (1,169 games) with full metadata and search terms.
 * Guarantees that even on Vercel, offline, or behind network blockers, all games are instantly ready.
 */
export function getLocalLuminGames(): Game[] {
  return (localLuminRaw as Array<{ id: string; name: string; image_token: string }>).map((g) => {
    const specialTags = inferLuminTags(g.name, g.id);
    return {
      id: `lumin-${g.id}`,
      name: g.name,
      cover: g.image_token
        ? `${LUMIN_API_BASE}/api/v1/icon/${g.image_token}`
        : "",
      url: `lumin:${g.id}`,
      author: undefined,
      featured: false,
      special: specialTags,
      source: "luminsdk",
      luminId: g.id,
      _search: (g.name + " " + specialTags.join(" ")).toLowerCase(),
    };
  });
}

/**
 * Fetches the entire game library from LuminSDK, without using any of its default UI.
 * Tries the native Lumin.getGames() method first; if not initialized yet or in background,
 * seamlessly fetches via the direct Lumin session & games API.
 * Falls back to the full bundled 1,169-game library if network or CORS restricts requests.
 */
export async function fetchLuminGames(): Promise<Game[]> {
  // Pure REST API fetch: 0 client SDK overhead, 0 background scripts, 0 lag
  try {
    const sessionRes = await fetch(`${LUMIN_API_BASE}/api/v1/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!sessionRes.ok) {
      throw new Error(`Failed to create Lumin session: ${sessionRes.statusText}`);
    }
    const { session_id } = await sessionRes.json();

    const gamesRes = await fetch(`${LUMIN_API_BASE}/api/v1/games?limit=5000`, {
      headers: { "X-Session": session_id },
    });
    if (!gamesRes.ok) {
      throw new Error(`Failed to fetch Lumin games: ${gamesRes.statusText}`);
    }
    const data = await gamesRes.json();
    const rawGames = (data.games || []) as Array<{ id: string; name: string; image_token: string }>;

    if (rawGames.length === 0) {
      return getLocalLuminGames();
    }

    return rawGames.map((g) => {
      const specialTags = inferLuminTags(g.name, g.id);
      return {
        id: `lumin-${g.id}`,
        name: g.name,
        cover: g.image_token
          ? `${LUMIN_API_BASE}/api/v1/icon/${g.image_token}`
          : "",
        url: `lumin:${g.id}`,
        author: undefined,
        featured: false,
        special: specialTags,
        source: "luminsdk",
        luminId: g.id,
        _search: (g.name + " " + specialTags.join(" ")).toLowerCase(),
      };
    });
  } catch (error) {
    console.warn("Could not fetch Lumin games library directly, using bundled database:", error);
    return getLocalLuminGames();
  }
}

/**
 * Resolves the direct URL for a Lumin game.
 * Uses window.Lumin.getGameUrl(luminId) if supported by the runtime.
 */
export async function getLuminGameUrl(luminId: string): Promise<string | null> {
  const initialized = await initLuminHeadless();
  if (initialized && window.Lumin && typeof window.Lumin.getGameUrl === "function") {
    try {
      const url = await window.Lumin.getGameUrl(luminId);
      if (url && typeof url === "string" && url.trim().length > 0) {
        return url;
      }
    } catch (err) {
      console.warn("Lumin.getGameUrl notice:", err);
    }
  }
  return null;
}

/**
 * Embeds a Lumin game directly inside a container element,
 * stripping away any separate window takeover or custom exit pills.
 */
export async function embedLuminGame(
  containerEl: HTMLElement,
  luminId: string
): Promise<HTMLIFrameElement | null> {
  await initLuminHeadless();
  if (!window.Lumin || typeof window.Lumin.loadGame !== "function") {
    return null;
  }

  // Clean up any old player instance first
  closeLuminGame();

  try {
    const loadPromise = window.Lumin.loadGame(luminId);

    // Watch for .lumin-player appearing and attach it cleanly inside containerEl
    const frame = await new Promise<HTMLIFrameElement | null>((resolve) => {
      let attempts = 0;
      const maxAttempts = 50;

      const check = () => {
        const playerEl = document.querySelector<HTMLElement>(".lumin-player");
        if (playerEl) {
          if (playerEl.parentElement !== containerEl) {
            containerEl.appendChild(playerEl);
          }
          playerEl.classList.add("lumin-embedded-player");

          // Suppress any Lumin exit flyout pills
          const flyout = playerEl.querySelector<HTMLElement>(".lumin-player-flyout");
          if (flyout) {
            flyout.style.display = "none";
          }

          const iframe = playerEl.querySelector<HTMLIFrameElement>("iframe, .lumin-player-frame");
          if (iframe) {
            resolve(iframe);
            return;
          }
        }

        attempts++;
        if (attempts >= maxAttempts) {
          resolve(null);
        } else {
          setTimeout(check, 100);
        }
      };

      check();
    });

    await loadPromise.catch(() => {});
    return frame;
  } catch (err) {
    console.error("Failed to embed Lumin game:", err);
    return null;
  }
}

/**
 * Launches a Lumin game (legacy fallback).
 */
export async function launchLuminGame(luminId: string): Promise<boolean> {
  await initLuminHeadless();
  if (window.Lumin && typeof window.Lumin.loadGame === "function") {
    try {
      await window.Lumin.loadGame(luminId);
      return true;
    } catch (err) {
      console.error("Failed to launch game via LuminSDK:", err);
      return false;
    }
  }
  return false;
}

/**
 * Closes any active Lumin game overlay and cleans up DOM elements.
 */
export function closeLuminGame(): void {
  if (window.Lumin && typeof window.Lumin.closeGame === "function") {
    try {
      window.Lumin.closeGame();
    } catch {
      // Ignore
    }
  }
  // Clean up any lingering player or flyout elements
  document.querySelectorAll(".lumin-player, .lumin-player-flyout, [class*='lumin-player']").forEach((el) => {
    // If it's the headless container, don't remove it
    if (el.id !== "lumin-headless-container" && !el.closest("#lumin-headless-container")) {
      el.remove();
    }
  });
}
