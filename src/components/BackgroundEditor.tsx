import React, { useRef, useState, useEffect } from "react";
import { ImagePlus, Palette, RotateCcw, X, Sparkles, Sliders, SunMedium, Paintbrush, Disc } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ColorWheel from "./ColorWheel";
import { applyTheme, getSavedTheme, DEFAULT_NAVY_THEME, ThemeRgb, rgbToHex, hexToRgb, calculateThemeShades } from "../utils/theme";

export type AppBackground = { type: "solid" | "gradient" | "image"; value: string };

// Default frosted background (Midnight Navy)
export const DEFAULT_BACKGROUND: AppBackground = {
  type: "gradient",
  value: "radial-gradient(circle at 50% 50%, #0a0e29 0%, #03040c 100%)"
};

export interface ThemePreset {
  name: string;
  type: "solid" | "gradient";
  value: string;
  preview: string;
  rgb?: ThemeRgb;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    name: "Midnight Navy (Default)",
    type: "gradient",
    value: "radial-gradient(circle at 50% 50%, #0a0e29 0%, #03040c 100%)",
    preview: "radial-gradient(circle at 50% 50%, #0a0e29 0%, #03040c 100%)",
    rgb: { r: 10, g: 14, b: 41 },
  },
  {
    name: "Obsidian Black",
    type: "solid",
    value: "#030305",
    preview: "#030305",
    rgb: { r: 8, g: 8, b: 12 },
  },
  {
    name: "Deep Ocean",
    type: "gradient",
    value: "linear-gradient(135deg, #010411 0%, #080d21 50%, #101130 100%)",
    preview: "linear-gradient(135deg, #010411 0%, #080d21 50%, #101130 100%)",
    rgb: { r: 16, g: 17, b: 48 },
  },
  {
    name: "Nebula Glow",
    type: "gradient",
    value: "radial-gradient(circle at 20% 20%, #2e1065 0%, #0f172a 60%, #020617 100%)",
    preview: "radial-gradient(circle at 20% 20%, #2e1065 0%, #0f172a 60%, #020617 100%)",
    rgb: { r: 46, g: 16, b: 101 },
  },
  {
    name: "Amethyst",
    type: "gradient",
    value: "linear-gradient(135deg, #0f051d 0%, #1e113a 50%, #07020d 100%)",
    preview: "linear-gradient(135deg, #0f051d 0%, #1e113a 50%, #07020d 100%)",
    rgb: { r: 30, g: 17, b: 58 },
  },
  {
    name: "Emerald Void",
    type: "gradient",
    value: "linear-gradient(135deg, #020a05 0%, #052e16 50%, #020617 100%)",
    preview: "linear-gradient(135deg, #020a05 0%, #052e16 50%, #020617 100%)",
    rgb: { r: 5, g: 46, b: 22 },
  },
  {
    name: "Volcano",
    type: "gradient",
    value: "linear-gradient(135deg, #0c0404 0%, #2a0f07 50%, #050505 100%)",
    preview: "linear-gradient(135deg, #0c0404 0%, #2a0f07 50%, #050505 100%)",
    rgb: { r: 42, g: 15, b: 7 },
  },
  {
    name: "Cyberpunk",
    type: "gradient",
    value: "radial-gradient(circle at 80% 80%, rgba(99, 102, 241, 0.15) 0%, rgba(219, 39, 119, 0.05) 50%, #030712 100%)",
    preview: "linear-gradient(135deg, #1e1b4b, #111827, #1c0216)",
    rgb: { r: 55, g: 15, b: 45 },
  },
];

// Quick color presets
const COLOR_PRESETS: { name: string; r: number; g: number; b: number; desc: string }[] = [
  { name: "Midnight Navy", r: 10, g: 14, b: 41, desc: "Original Navy Blue" },
  { name: "Crimson Ember", r: 190, g: 25, b: 40, desc: "Blood Red" },
  { name: "Emerald Glade", r: 20, g: 180, b: 85, desc: "Forest Green" },
  { name: "Royal Amethyst", r: 135, g: 35, b: 215, desc: "Deep Violet" },
  { name: "Cyberpunk Pink", r: 235, g: 30, b: 140, desc: "Hot Neon Pink" },
  { name: "Electric Cyan", r: 0, g: 210, b: 240, desc: "Vibrant Cyan" },
  { name: "Amber Flame", r: 230, g: 125, b: 20, desc: "Warm Orange" },
  { name: "Pure Obsidian", r: 12, g: 12, b: 16, desc: "Dark Stealth" },
];

function extractColorFromBackground(bg: AppBackground): { r: number; g: number; b: number; mode: "glow" | "solid" } {
  const defaultRes = { r: 10, g: 14, b: 41, mode: "glow" as const };
  if (!bg || !bg.value) return defaultRes;

  if (bg.type === "solid") {
    const rgbMatch = bg.value.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
    if (rgbMatch) {
      return { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]), mode: "solid" };
    }
    const parsedHex = hexToRgb(bg.value);
    if (parsedHex) {
      return { ...parsedHex, mode: "solid" };
    }
    return defaultRes;
  }

  if (bg.type === "gradient") {
    const rgbMatch = bg.value.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
    if (rgbMatch) {
      return { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]), mode: "glow" };
    }
    const hexMatch = bg.value.match(/#([0-9a-f]{6}|[0-9a-f]{3})/i);
    if (hexMatch) {
      const parsedHex = hexToRgb(hexMatch[0]);
      if (parsedHex) {
        return { ...parsedHex, mode: "glow" };
      }
    }
  }

  return defaultRes;
}

export interface BackgroundEditorProps {
  background: AppBackground;
  onChange: (background: AppBackground) => void;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function BackgroundEditor({
  background,
  onChange,
  isOpen,
  onOpenChange,
}: BackgroundEditorProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = typeof isOpen === "boolean";
  const open = isControlled ? isOpen : internalOpen;

  const setOpen = (val: boolean) => {
    if (isControlled && onOpenChange) {
      onOpenChange(val);
    } else {
      setInternalOpen(val);
    }
  };

  const inputRef = useRef<HTMLInputElement>(null);

  // Editor mode tab: "wheel" (chromatic circle) vs "sliders" (RGB numbers)
  const [pickerTab, setPickerTab] = useState<"wheel" | "sliders">("wheel");

  // RGB State
  const [r, setR] = useState(10);
  const [g, setG] = useState(14);
  const [b, setB] = useState(41);
  const [colorMode, setColorMode] = useState<"glow" | "solid">("glow");

  // Sync state whenever modal opens or background changes
  useEffect(() => {
    const savedTheme = getSavedTheme();
    if (savedTheme) {
      setR(savedTheme.r);
      setG(savedTheme.g);
      setB(savedTheme.b);
    } else if (background) {
      const parsed = extractColorFromBackground(background);
      setR(parsed.r);
      setG(parsed.g);
      setB(parsed.b);
      setColorMode(parsed.mode);
    }
  }, [background, open]);

  const updateBackground = (next: AppBackground) => {
    onChange(next);
    try {
      localStorage.setItem("frosted_background", JSON.stringify(next));
    } catch {}
  };

  /**
   * Applies the color both to the background and across ALL app surfaces!
   */
  const applyColor = (newR: number, newG: number, newB: number, newMode: "glow" | "solid" = colorMode) => {
    const clampedR = Math.max(0, Math.min(255, Math.round(newR)));
    const clampedG = Math.max(0, Math.min(255, Math.round(newG)));
    const clampedB = Math.max(0, Math.min(255, Math.round(newB)));

    setR(clampedR);
    setG(clampedG);
    setB(clampedB);
    setColorMode(newMode);

    // 1. Update the entire app's navy blue surfaces, headers, footers, borders, buttons
    applyTheme(clampedR, clampedG, clampedB);

    // 2. Update the background canvas
    if (newMode === "glow") {
      const shades = calculateThemeShades(clampedR, clampedG, clampedB);
      updateBackground({
        type: "gradient",
        value: `radial-gradient(circle at 50% 50%, rgb(${clampedR}, ${clampedG}, ${clampedB}) 0%, ${shades.chatBg} 100%)`
      });
    } else {
      updateBackground({
        type: "solid",
        value: `rgb(${clampedR}, ${clampedG}, ${clampedB})`
      });
    }
  };

  const handleColorWheelChange = (newRgb: ThemeRgb) => {
    applyColor(newRgb.r, newRgb.g, newRgb.b, colorMode);
  };

  const handleHexChange = (hex: string) => {
    const parsed = hexToRgb(hex);
    if (parsed) {
      applyColor(parsed.r, parsed.g, parsed.b, colorMode);
    }
  };

  const handleImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => updateBackground({ type: "image", value: String(reader.result) });
    reader.readAsDataURL(file);
  };

  const currentHex = rgbToHex(r, g, b);
  const isDefaultNavy = r === 10 && g === 14 && b === 41 && colorMode === "glow";

  return (
    <>
      {/* Floating Launcher Button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Customize theme"
        title="Customize theme"
        className="fixed bottom-5 left-5 z-30 flex h-10 px-3.5 items-center gap-2 rounded-xl border border-white/15 bg-[#121420]/90 text-white shadow-xl backdrop-blur-md transition-all hover:bg-[#181b2c] hover:border-white/25 active:scale-95 cursor-pointer group"
      >
        <div
          className="w-3.5 h-3.5 rounded-full border border-white/60 shadow-sm flex-shrink-0"
          style={{
            background:
              "conic-gradient(from 0deg, #38bdf8, #818cf8, #c084fc, #f472b6, #fb7185, #f59e0b, #34d399, #38bdf8)",
          }}
        />
        <span className="text-xs font-semibold tracking-normal text-neutral-200 group-hover:text-white">Theme</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-4 sm:items-center backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-labelledby="background-editor-title"
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#121420] p-5 sm:p-6 text-white shadow-2xl custom-scrollbar"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">
                    <Palette size={16} />
                  </div>
                  <div>
                    <h2 id="background-editor-title" className="text-sm font-semibold tracking-tight text-white">
                      Theme & Appearance
                    </h2>
                    <p className="text-xs text-neutral-400">
                      Personalize your background and accent colors
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                  aria-label="Close theme editor"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex flex-col gap-4">
                {/* Main Color Picker Card */}
                <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                  {/* Top Bar: Selector Tabs & Glow/Solid Switch */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-3.5">
                    {/* Picker Type: Wheel vs Sliders */}
                    <div className="inline-flex rounded-lg bg-white/5 p-0.5 border border-white/10 text-xs">
                      <button
                        type="button"
                        onClick={() => setPickerTab("wheel")}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-all cursor-pointer ${
                          pickerTab === "wheel"
                            ? "bg-white/20 text-white shadow-sm"
                            : "text-neutral-400 hover:text-white"
                        }`}
                      >
                        <Disc size={13} className="text-pink-400" />
                        <span>Color Wheel</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPickerTab("sliders")}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-all cursor-pointer ${
                          pickerTab === "sliders"
                            ? "bg-white/20 text-white shadow-sm"
                            : "text-neutral-400 hover:text-white"
                        }`}
                      >
                        <Sliders size={13} className="text-indigo-400" />
                        <span>RGB Sliders</span>
                      </button>
                    </div>

                    {/* Mode Switcher: Glow vs Solid */}
                    <div className="flex rounded-lg bg-white/5 p-0.5 border border-white/10 text-xs">
                      <button
                        type="button"
                        onClick={() => applyColor(r, g, b, "glow")}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-medium transition-all cursor-pointer ${
                          colorMode === "glow"
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "text-neutral-400 hover:text-neutral-200"
                        }`}
                        title="Ambient radial glow"
                      >
                        <SunMedium size={12} />
                        <span>Glow</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => applyColor(r, g, b, "solid")}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-medium transition-all cursor-pointer ${
                          colorMode === "solid"
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "text-neutral-400 hover:text-neutral-200"
                        }`}
                        title="Solid background"
                      >
                        <Paintbrush size={12} />
                        <span>Solid</span>
                      </button>
                    </div>
                  </div>

                  {/* Tab 1: Circular Chromatic Color Wheel */}
                  {pickerTab === "wheel" && (
                    <div className="py-2 flex flex-col items-center">
                      <ColorWheel
                        color={{ r, g, b }}
                        onChange={handleColorWheelChange}
                        size={210}
                      />
                    </div>
                  )}

                  {/* Tab 2: Direct RGB Sliders */}
                  {pickerTab === "sliders" && (
                    <div className="space-y-3 py-2">
                      {/* Red Slider */}
                      <div className="flex items-center gap-2.5">
                        <span className="w-4 text-xs font-semibold text-red-400">R</span>
                        <input
                          type="range"
                          min={0}
                          max={255}
                          value={r}
                          onChange={(e) => applyColor(Number(e.target.value), g, b, colorMode)}
                          className="flex-1 h-1.5 cursor-pointer appearance-none rounded-lg bg-red-950/60 accent-red-500"
                        />
                        <input
                          type="number"
                          min={0}
                          max={255}
                          value={r}
                          onChange={(e) => applyColor(Number(e.target.value) || 0, g, b, colorMode)}
                          className="w-14 rounded bg-black/60 border border-white/10 px-2 py-1 text-right font-mono text-xs text-red-300 focus:outline-none focus:border-red-500"
                        />
                      </div>

                      {/* Green Slider */}
                      <div className="flex items-center gap-2.5">
                        <span className="w-4 text-xs font-semibold text-emerald-400">G</span>
                        <input
                          type="range"
                          min={0}
                          max={255}
                          value={g}
                          onChange={(e) => applyColor(r, Number(e.target.value), b, colorMode)}
                          className="flex-1 h-1.5 cursor-pointer appearance-none rounded-lg bg-emerald-950/60 accent-emerald-500"
                        />
                        <input
                          type="number"
                          min={0}
                          max={255}
                          value={g}
                          onChange={(e) => applyColor(r, Number(e.target.value) || 0, b, colorMode)}
                          className="w-14 rounded bg-black/60 border border-white/10 px-2 py-1 text-right font-mono text-xs text-emerald-300 focus:outline-none focus:border-emerald-500"
                        />
                      </div>

                      {/* Blue Slider */}
                      <div className="flex items-center gap-2.5">
                        <span className="w-4 text-xs font-semibold text-blue-400">B</span>
                        <input
                          type="range"
                          min={0}
                          max={255}
                          value={b}
                          onChange={(e) => applyColor(r, g, Number(e.target.value), colorMode)}
                          className="flex-1 h-1.5 cursor-pointer appearance-none rounded-lg bg-blue-950/60 accent-blue-500"
                        />
                        <input
                          type="number"
                          min={0}
                          max={255}
                          value={b}
                          onChange={(e) => applyColor(r, g, Number(e.target.value) || 0, colorMode)}
                          className="w-14 rounded bg-black/60 border border-white/10 px-2 py-1 text-right font-mono text-xs text-blue-300 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>
                  )}

                  {/* Live Value & Native Picker Bar */}
                  <div className="mt-3.5 flex items-center gap-3 p-2.5 rounded-lg bg-white/5 border border-white/10">
                    <div
                      className="h-9 w-12 rounded-md border border-white/20 shadow-inner flex-shrink-0 transition-colors"
                      style={{
                        background: colorMode === "glow"
                          ? `radial-gradient(circle at 50% 50%, rgb(${r}, ${g}, ${b}) 0%, ${calculateThemeShades(r, g, b).chatBg} 100%)`
                          : `rgb(${r}, ${g}, ${b})`
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-semibold text-white uppercase tracking-wider">
                          {currentHex}
                        </span>
                        <span className="text-[10px] font-mono text-neutral-400">
                          RGB({r}, {g}, {b})
                        </span>
                      </div>
                      <div className="text-[11px] text-neutral-400 truncate">
                        {isDefaultNavy ? "Midnight Navy (Default)" : "Custom color active"}
                      </div>
                    </div>
                    <input
                      type="color"
                      value={currentHex}
                      onChange={(e) => handleHexChange(e.target.value)}
                      title="Choose custom color"
                      className="h-8 w-8 cursor-pointer rounded-md bg-transparent border border-white/10"
                    />
                  </div>

                  {/* Popular Color Swatches */}
                  <div className="mt-3 pt-3 border-t border-white/10">
                    <p className="text-[11px] font-medium text-neutral-400 mb-2">
                      Popular colors
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                      {COLOR_PRESETS.map((preset) => {
                        const isSelected = r === preset.r && g === preset.g && b === preset.b;
                        return (
                          <button
                            key={preset.name}
                            type="button"
                            onClick={() => applyColor(preset.r, preset.g, preset.b, colorMode)}
                            title={`${preset.name}`}
                            className={`flex items-center gap-2 p-1.5 rounded-lg border text-left text-xs transition-all cursor-pointer ${
                              isSelected
                                ? "border-white/80 bg-white/20 text-white font-medium shadow-sm"
                                : "border-white/10 bg-white/5 text-neutral-300 hover:border-white/20 hover:text-white"
                            }`}
                          >
                            <span
                              className="h-3.5 w-3.5 rounded-full flex-shrink-0 border border-white/30 shadow-sm"
                              style={{ backgroundColor: `rgb(${preset.r}, ${preset.g}, ${preset.b})` }}
                            />
                            <span className="truncate">{preset.name.split(" ")[0]}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Preset Themes */}
                <div>
                  <p className="mb-2 text-xs font-medium text-neutral-400">
                    Themes
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {THEME_PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        title={preset.name}
                        aria-label={`Use ${preset.name} background`}
                        onClick={() => {
                          updateBackground({ type: preset.type, value: preset.value });
                          if (preset.rgb) {
                            applyTheme(preset.rgb.r, preset.rgb.g, preset.rgb.b);
                            setR(preset.rgb.r);
                            setG(preset.rgb.g);
                            setB(preset.rgb.b);
                          }
                        }}
                        className={`group relative h-9 w-full rounded-xl border transition-all duration-150 cursor-pointer ${
                          background.value === preset.value
                            ? "border-white ring-2 ring-white/40 scale-95"
                            : "border-white/10 hover:border-white/30 hover:scale-105"
                        }`}
                        style={{ background: preset.preview }}
                      >
                        <span className="absolute inset-0 rounded-xl bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Picture Uploader */}
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-left text-xs text-neutral-200 hover:bg-white/[0.08] hover:border-white/20 transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <ImagePlus size={16} className="text-indigo-400" />
                    <div className="flex flex-col">
                      <span className="font-medium text-white">Custom wallpaper</span>
                      <span className="text-[11px] text-neutral-400">Upload your own photo or picture</span>
                    </div>
                  </div>
                </button>
                <input ref={inputRef} type="file" accept="image/*" onChange={handleImage} className="sr-only" />

                {/* Reset to Default */}
                <button
                  type="button"
                  onClick={() => {
                    updateBackground(DEFAULT_BACKGROUND);
                    applyColor(DEFAULT_NAVY_THEME.r, DEFAULT_NAVY_THEME.g, DEFAULT_NAVY_THEME.b, "glow");
                  }}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.02] py-2.5 text-xs font-medium text-neutral-300 hover:bg-white/[0.06] hover:text-white transition-all cursor-pointer"
                >
                  <RotateCcw size={13} />
                  <span>Reset to default theme</span>
                </button>
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
