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
    name: "Default (Frosted)",
    title: "frosted",
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

export function applyTabCloak(cloak: { id: string; title: string; icon: string }): void {
  try {
    // 1. Update Document Title
    document.title = cloak.title || "frosted";

    // 2. Resolve icon URL
    const iconHref = cloak.icon || "/favicon.svg";

    // Check for existing link icons
    let iconLink = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!iconLink) {
      iconLink = document.createElement("link");
      iconLink.rel = "icon";
      document.head.appendChild(iconLink);
    }

    const isSvg = iconHref.includes(".svg") || iconHref.startsWith("data:image/svg");
    const isPng = iconHref.includes(".png") || iconHref.startsWith("data:image/png");
    iconLink.type = isSvg ? "image/svg+xml" : isPng ? "image/png" : "image/x-icon";
    iconLink.href = iconHref;

    // Shortcut icon for Chromium and Edge
    let shortcutLink = document.querySelector<HTMLLinkElement>("link[rel='shortcut icon']");
    if (!shortcutLink) {
      shortcutLink = document.createElement("link");
      shortcutLink.rel = "shortcut icon";
      document.head.appendChild(shortcutLink);
    }
    shortcutLink.type = iconLink.type;
    shortcutLink.href = iconHref;

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
    title: "frosted",
    icon: "/favicon.svg",
  };
}

export function resetTabCloak(): void {
  applyTabCloak({
    id: "default",
    title: "frosted",
    icon: "/favicon.svg",
  });
}
