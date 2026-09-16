/**
 * Global Theme Engine for Frosted Studying
 * Transforms all app-wide navy blue accents, surfaces, headers, footers,
 * and borders into any custom color chosen from the Color Wheel or RGB editor.
 */

export interface ThemeRgb {
  r: number;
  g: number;
  b: number;
}

export const DEFAULT_NAVY_THEME: ThemeRgb = {
  r: 10,
  g: 14,
  b: 41,
};

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToRgb(hex: string): ThemeRgb | null {
  const clean = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(clean)) return null;
  const full = clean.length === 3
    ? clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2]
    : clean;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function hsvToRgb(h: number, s: number, v: number): ThemeRgb {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;

  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
      case gn: h = (bn - rn) / d + 2; break;
      case bn: h = (rn - gn) / d + 4; break;
    }
    h *= 60;
  }

  return { h: Math.round(h), s, v };
}

/**
 * Calculates responsive, accessible surface shades from any RGB base.
 * Calibrated so the default Midnight Navy (10, 14, 41) reproduces
 * the exact original hex values:
 * - darkest: #040616
 * - surface: #070b22
 * - hover:   #0a0f30
 * - accent:  #0c1642
 * - accentHover: #122060
 */
export function calculateThemeShades(r: number, g: number, b: number) {
  // Clamp inputs
  const cr = Math.max(0, Math.min(255, r));
  const cg = Math.max(0, Math.min(255, g));
  const cb = Math.max(0, Math.min(255, b));

  // Determine dominant hue for tinting text
  const { h, s } = rgbToHsv(cr, cg, cb);
  const effectiveSat = Math.max(25, Math.min(85, s * 100));

  const darkest = `rgb(${Math.round(cr * 0.15 + 2)}, ${Math.round(cg * 0.15 + 3)}, ${Math.round(cb * 0.15 + 10)})`;
  const surface = `rgb(${Math.round(cr * 0.25 + 3)}, ${Math.round(cg * 0.25 + 5)}, ${Math.round(cb * 0.25 + 18)})`;
  const hover = `rgb(${Math.round(cr * 0.35 + 4)}, ${Math.round(cg * 0.35 + 7)}, ${Math.round(cb * 0.35 + 25)})`;
  const accent = `rgb(${Math.round(cr * 0.55 + 5)}, ${Math.round(cg * 0.55 + 9)}, ${Math.round(cb * 0.55 + 35)})`;
  const accentHover = `rgb(${Math.round(cr * 0.75 + 8)}, ${Math.round(cg * 0.75 + 14)}, ${Math.round(cb * 0.75 + 48)})`;

  // Explicit Discord-style chat shades derived from chosen color
  const chatBg = `rgb(${Math.round(cr * 0.05 + 2)}, ${Math.round(cg * 0.05 + 2)}, ${Math.round(cb * 0.05 + 6)})`;
  const chatRail = `rgb(${Math.round(cr * 0.03 + 1)}, ${Math.round(cg * 0.03 + 1)}, ${Math.round(cb * 0.03 + 4)})`;
  const chatSidebar = `rgb(${Math.round(cr * 0.08 + 2)}, ${Math.round(cg * 0.08 + 3)}, ${Math.round(cb * 0.08 + 9)})`;
  const chatInput = `rgb(${Math.round(cr * 0.15 + 3)}, ${Math.round(cg * 0.15 + 5)}, ${Math.round(cb * 0.15 + 16)})`;
  const chatHover = `rgb(${Math.round(cr * 0.25 + 4)}, ${Math.round(cg * 0.25 + 6)}, ${Math.round(cb * 0.25 + 22)})`;
  const chatActive = `rgb(${Math.round(cr * 0.50 + 5)}, ${Math.round(cg * 0.50 + 8)}, ${Math.round(cb * 0.50 + 32)})`;

  // Calculate scaled vibrancy for indigo replacement shades
  const ind500 = `hsl(${h}, ${effectiveSat}%, 55%)`;
  const ind600 = `hsl(${h}, ${effectiveSat}%, 45%)`;
  const ind400 = `hsl(${h}, ${effectiveSat}%, 66%)`;
  const ind300 = `hsl(${h}, ${effectiveSat}%, 78%)`;
  const ind200 = `hsl(${h}, ${effectiveSat}%, 88%)`;
  const ind100 = `hsl(${h}, ${effectiveSat}%, 94%)`;
  const ind700 = `hsl(${h}, ${effectiveSat}%, 35%)`;
  const ind800 = `hsl(${h}, ${effectiveSat}%, 25%)`;
  const ind900 = `hsl(${h}, ${effectiveSat}%, 16%)`;
  const ind950 = `hsl(${h}, ${effectiveSat}%, 8%)`;

  const border = `rgba(${cr}, ${cg}, ${cb}, 0.38)`;
  const borderSubtle = `rgba(${cr}, ${cg}, ${cb}, 0.20)`;
  const borderStrong = `rgba(${Math.min(255, cr + 40)}, ${Math.min(255, cg + 40)}, ${Math.min(255, cb + 60)}, 0.75)`;

  const textAccent = `hsl(${h}, ${effectiveSat}%, 82%)`;
  const textMuted = `hsl(${h}, ${effectiveSat}%, 65%)`;
  const glow = `rgb(${cr}, ${cg}, ${cb})`;

  return {
    r: cr,
    g: cg,
    b: cb,
    hex: rgbToHex(cr, cg, cb),
    darkest,
    surface,
    hover,
    accent,
    accentHover,
    chatBg,
    chatRail,
    chatSidebar,
    chatInput,
    chatHover,
    chatActive,
    ind500,
    ind600,
    ind400,
    ind300,
    ind200,
    ind100,
    ind700,
    ind800,
    ind900,
    ind950,
    border,
    borderSubtle,
    borderStrong,
    textAccent,
    textMuted,
    glow,
  };
}

/**
 * Apply the theme properties to document root (:root)
 */
export function applyTheme(r: number, g: number, b: number) {
  if (typeof document === "undefined") return;

  const shades = calculateThemeShades(r, g, b);
  const root = document.documentElement;

  root.style.setProperty("--theme-r", `${shades.r}`);
  root.style.setProperty("--theme-g", `${shades.g}`);
  root.style.setProperty("--theme-b", `${shades.b}`);
  root.style.setProperty("--theme-primary", `rgb(${shades.r}, ${shades.g}, ${shades.b})`);
  root.style.setProperty("--theme-darkest", shades.darkest);
  root.style.setProperty("--theme-surface", shades.surface);
  root.style.setProperty("--theme-hover", shades.hover);
  root.style.setProperty("--theme-accent", shades.accent);
  root.style.setProperty("--theme-accent-hover", shades.accentHover);

  // Chat-specific custom properties
  root.style.setProperty("--theme-chat-bg", shades.chatBg);
  root.style.setProperty("--theme-chat-rail", shades.chatRail);
  root.style.setProperty("--theme-chat-sidebar", shades.chatSidebar);
  root.style.setProperty("--theme-chat-input", shades.chatInput);
  root.style.setProperty("--theme-chat-hover", shades.chatHover);
  root.style.setProperty("--theme-chat-active", shades.chatActive);

  // Indigo replacement scale for whole-app theme propagation
  root.style.setProperty("--theme-indigo-500", shades.ind500);
  root.style.setProperty("--theme-indigo-600", shades.ind600);
  root.style.setProperty("--theme-indigo-400", shades.ind400);
  root.style.setProperty("--theme-indigo-300", shades.ind300);
  root.style.setProperty("--theme-indigo-200", shades.ind200);
  root.style.setProperty("--theme-indigo-100", shades.ind100);
  root.style.setProperty("--theme-indigo-700", shades.ind700);
  root.style.setProperty("--theme-indigo-800", shades.ind800);
  root.style.setProperty("--theme-indigo-900", shades.ind900);
  root.style.setProperty("--theme-indigo-950", shades.ind950);

  root.style.setProperty("--theme-border", shades.border);
  root.style.setProperty("--theme-border-subtle", shades.borderSubtle);
  root.style.setProperty("--theme-border-strong", shades.borderStrong);
  root.style.setProperty("--theme-text-accent", shades.textAccent);
  root.style.setProperty("--theme-text-muted", shades.textMuted);
  root.style.setProperty("--theme-glow", shades.glow);

  try {
    localStorage.setItem("frosted_theme_color", JSON.stringify({ r: shades.r, g: shades.g, b: shades.b }));
  } catch {}
}

export function getSavedTheme(): ThemeRgb {
  if (typeof window === "undefined") return DEFAULT_NAVY_THEME;
  try {
    const raw = localStorage.getItem("frosted_theme_color");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.r === "number" && typeof parsed?.g === "number" && typeof parsed?.b === "number") {
        return {
          r: Math.max(0, Math.min(255, parsed.r)),
          g: Math.max(0, Math.min(255, parsed.g)),
          b: Math.max(0, Math.min(255, parsed.b)),
        };
      }
    }
  } catch {}
  return DEFAULT_NAVY_THEME;
}
