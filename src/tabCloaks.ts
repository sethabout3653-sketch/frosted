export interface TabCloak {
  id: string;
  name: string;
  title: string;
  category: "google" | "school" | "entertainment" | "utility" | "custom" | "default";
  iconUrl: string;
}

export const TAB_CLOAKS: TabCloak[] = [
  {
    id: "default",
    name: "Default (FrostedStudying)",
    title: "FrostedStudying",
    category: "default",
    iconUrl: "/favicon.svg",
  },
  {
    id: "chrome_newtab",
    name: "Chrome (New Tab)",
    title: "New Tab",
    category: "google",
    iconUrl: "/cloaks/chrome_newtab.svg",
  },
  {
    id: "clever",
    name: "Clever",
    title: "Clever | Portal",
    category: "school",
    iconUrl: "/cloaks/clever.ico",
  },
  {
    id: "google_docs",
    name: "Google Docs",
    title: "Google Docs",
    category: "google",
    iconUrl: "/cloaks/google_docs.ico",
  },
  {
    id: "google_slides",
    name: "Google Slides",
    title: "Google Slides",
    category: "google",
    iconUrl: "/cloaks/google_slides.ico",
  },
  {
    id: "google_drive",
    name: "Google Drive",
    title: "My Drive - Google Drive",
    category: "google",
    iconUrl: "/cloaks/google_drive.png",
  },
  {
    id: "google_classroom",
    name: "Google Classroom",
    title: "Classes",
    category: "school",
    iconUrl: "/cloaks/google_classroom.png",
  },
  {
    id: "google",
    name: "Google",
    title: "Google",
    category: "google",
    iconUrl: "/cloaks/google.ico",
  },
  {
    id: "canvas",
    name: "Canvas LMS",
    title: "Dashboard",
    category: "school",
    iconUrl: "/cloaks/canvas.ico",
  },
  {
    id: "schoology",
    name: "Schoology",
    title: "Home | Schoology",
    category: "school",
    iconUrl: "/cloaks/schoology.ico",
  },
  {
    id: "quizlet",
    name: "Quizlet",
    title: "Learning tools, flashcards, and textbook solutions | Quizlet",
    category: "school",
    iconUrl: "/cloaks/quizlet.ico",
  },
  {
    id: "khan_academy",
    name: "Khan Academy",
    title: "Dashboard | Khan Academy",
    category: "school",
    iconUrl: "/cloaks/khan_academy.ico",
  },
  {
    id: "desmos",
    name: "Desmos",
    title: "Desmos | Graphing Calculator",
    category: "school",
    iconUrl: "/cloaks/desmos.ico",
  },
  {
    id: "deltamath",
    name: "DeltaMath",
    title: "DeltaMath",
    category: "school",
    iconUrl: "/cloaks/deltamath.ico",
  },
  {
    id: "edpuzzle",
    name: "Edpuzzle",
    title: "Edpuzzle",
    category: "school",
    iconUrl: "/cloaks/edpuzzle.png",
  },
  {
    id: "ixl",
    name: "IXL",
    title: "IXL | Dashboard",
    category: "school",
    iconUrl: "/cloaks/ixl.ico",
  },
  {
    id: "gmail",
    name: "Gmail",
    title: "Inbox - Gmail",
    category: "google",
    iconUrl: "/cloaks/gmail.ico",
  },
  {
    id: "youtube",
    name: "YouTube",
    title: "YouTube",
    category: "entertainment",
    iconUrl: "/cloaks/youtube.ico",
  },
  {
    id: "spotify",
    name: "Spotify",
    title: "Spotify - Web Player: Music for everyone",
    category: "entertainment",
    iconUrl: "/cloaks/spotify.ico",
  },
  {
    id: "discord",
    name: "Discord",
    title: "Discord | Friends",
    category: "entertainment",
    iconUrl: "/cloaks/discord.ico",
  },
  {
    id: "wikipedia",
    name: "Wikipedia",
    title: "Wikipedia, the free encyclopedia",
    category: "utility",
    iconUrl: "/cloaks/wikipedia.ico",
  },
];

const LOCAL_STORAGE_KEY = "frosted_tab_cloak";

export interface ActiveCloakState {
  id: string;
  title: string;
  icon: string;
}

// Global theme change listener handler
let themeListenerAttached = false;

function setupThemeListener() {
  if (typeof window === "undefined" || themeListenerAttached) return;
  themeListenerAttached = true;

  try {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const saved = getSavedTabCloak();
      if (saved && saved.id === "chrome_newtab") {
        applyTabCloak(saved);
      }
    };
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handler);
    } else if ((mediaQuery as any).addListener) {
      (mediaQuery as any).addListener(handler);
    }
  } catch (err) {
    console.debug("Theme listener init error:", err);
  }
}

export function applyTabCloak(cloak: { id: string; title: string; icon: string }): void {
  try {
    setupThemeListener();

    // 1. Update Document Title
    document.title = cloak.title || "FrostedStudying";

    // 2. Resolve icon URL based on browser color / theme
    let iconHref = cloak.icon || "/favicon.svg";

    const isDarkTheme = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

    // If Chrome New Tab, adapt directly to dark or light browser theme
    if (cloak.id === "chrome_newtab") {
      iconHref = isDarkTheme ? "/cloaks/chrome_newtab_dark.svg" : "/cloaks/chrome_newtab_light.svg";
    }

    // 3. Remove previous icon links to force Chrome/browser tab cache refresh
    const existingLinks = document.querySelectorAll<HTMLLinkElement>("link[rel~='icon'], link[rel='shortcut icon']");
    existingLinks.forEach((el) => el.remove());

    const isSvg = iconHref.includes(".svg") || iconHref.startsWith("data:image/svg");
    const isPng = iconHref.includes(".png") || iconHref.startsWith("data:image/png");
    const mimeType = isSvg ? "image/svg+xml" : isPng ? "image/png" : "image/x-icon";

    if (cloak.id === "chrome_newtab") {
      // Add responsive media-query icon tags
      const darkLink = document.createElement("link");
      darkLink.rel = "icon";
      darkLink.type = "image/svg+xml";
      darkLink.media = "(prefers-color-scheme: dark)";
      darkLink.href = "/cloaks/chrome_newtab_dark.svg";
      document.head.appendChild(darkLink);

      const lightLink = document.createElement("link");
      lightLink.rel = "icon";
      lightLink.type = "image/svg+xml";
      lightLink.media = "(prefers-color-scheme: light)";
      lightLink.href = "/cloaks/chrome_newtab_light.svg";
      document.head.appendChild(lightLink);

      const shortcutLink = document.createElement("link");
      shortcutLink.rel = "shortcut icon";
      shortcutLink.type = "image/svg+xml";
      shortcutLink.href = isDarkTheme ? "/cloaks/chrome_newtab_dark.svg" : "/cloaks/chrome_newtab_light.svg";
      document.head.appendChild(shortcutLink);
    } else {
      const iconLink = document.createElement("link");
      iconLink.rel = "icon";
      iconLink.type = mimeType;
      iconLink.href = iconHref;
      document.head.appendChild(iconLink);

      const shortcutLink = document.createElement("link");
      shortcutLink.rel = "shortcut icon";
      shortcutLink.type = mimeType;
      shortcutLink.href = iconHref;
      document.head.appendChild(shortcutLink);
    }

    // Persist to local storage
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cloak));
  } catch (err) {
    console.error("Failed to apply tab cloak:", err);
  }
}

export function getSavedTabCloak(): ActiveCloakState {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.id) {
        // Upgrade legacy saved state to real official images
        const found = TAB_CLOAKS.find((c) => c.id === parsed.id);
        if (found) {
          return {
            id: found.id,
            title: found.title,
            icon: found.iconUrl,
          };
        }
        if (parsed.title && parsed.icon) {
          return parsed;
        }
      }
    }
  } catch {
    // fallback
  }
  return {
    id: "default",
    title: "FrostedStudying",
    icon: "/favicon.svg",
  };
}

export function resetTabCloak(): void {
  applyTabCloak({
    id: "default",
    title: "FrostedStudying",
    icon: "/favicon.svg",
  });
}
