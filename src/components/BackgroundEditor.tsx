import React, { useRef, useState, useEffect } from "react";
import { ImagePlus, Palette, RotateCcw, X, Sparkles, Sliders, SunMedium, Paintbrush } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export type AppBackground = { type: "solid" | "gradient" | "image"; value: string };

// Stunning default frosted background (Midnight Aurora)
export const DEFAULT_BACKGROUND: AppBackground = {
  type: "gradient",
  value: "radial-gradient(circle at 50% 50%, #0a0e29 0%, #03040c 100%)"
};

export interface ThemePreset {
  name: string;
  type: "solid" | "gradient";
  value: string;
  preview: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    name: "Obsidian Black",
    type: "solid",
    value: "#030305",
    preview: "#030305",
  },
  {
    name: "Midnight Navy",
    type: "gradient",
    value: "radial-gradient(circle at 50% 50%, #0a0e29 0%, #03040c 100%)",
    preview: "radial-gradient(circle at 50% 50%, #0a0e29 0%, #03040c 100%)",
  },
  {
    name: "Deep Ocean",
    type: "gradient",
    value: "linear-gradient(135deg, #010411 0%, #080d21 50%, #101130 100%)",
    preview: "linear-gradient(135deg, #010411 0%, #080d21 50%, #101130 100%)",
  },
  {
    name: "Nebula Glow",
    type: "gradient",
    value: "radial-gradient(circle at 20% 20%, #2e1065 0%, #0f172a 60%, #020617 100%)",
    preview: "radial-gradient(circle at 20% 20%, #2e1065 0%, #0f172a 60%, #020617 100%)",
  },
  {
    name: "Amethyst",
    type: "gradient",
    value: "linear-gradient(135deg, #0f051d 0%, #1e113a 50%, #07020d 100%)",
    preview: "linear-gradient(135deg, #0f051d 0%, #1e113a 50%, #07020d 100%)",
  },
  {
    name: "Emerald Void",
    type: "gradient",
    value: "linear-gradient(135deg, #020a05 0%, #052e16 50%, #020617 100%)",
    preview: "linear-gradient(135deg, #020a05 0%, #052e16 50%, #020617 100%)",
  },
  {
    name: "Volcano",
    type: "gradient",
    value: "linear-gradient(135deg, #0c0404 0%, #2a0f07 50%, #050505 100%)",
    preview: "linear-gradient(135deg, #0c0404 0%, #2a0f07 50%, #050505 100%)",
  },
  {
    name: "Cyberpunk",
    type: "gradient",
    value: "radial-gradient(circle at 80% 80%, rgba(99, 102, 241, 0.15) 0%, rgba(219, 39, 119, 0.05) 50%, #030712 100%)",
    preview: "linear-gradient(135deg, #1e1b4b, #111827, #1c0216)",
  },
];

// Quick RGB color swatches for instant presets
const RGB_PRESETS = [
  { name: "Midnight Navy", r: 10, g: 14, b: 41, desc: "Default Navy Blue" },
  { name: "Crimson Ember", r: 48, g: 12, b: 18, desc: "Dark Red" },
  { name: "Emerald Glade", r: 12, g: 42, b: 24, desc: "Forest Green" },
  { name: "Royal Violet", r: 42, g: 16, b: 64, desc: "Deep Purple" },
  { name: "Cyberpunk Pink", r: 58, g: 14, b: 48, desc: "Neon Magenta" },
  { name: "Abyssal Cyan", r: 10, g: 38, b: 52, desc: "Deep Teal" },
  { name: "Warm Bronze", r: 50, g: 30, b: 10, desc: "Earthy Amber" },
  { name: "Pure Obsidian", r: 8, g: 8, b: 10, desc: "Pitch Black" },
];

function extractColorFromBackground(bg: AppBackground): { r: number; g: number; b: number; mode: "glow" | "solid" } {
  const defaultRes = { r: 10, g: 14, b: 41, mode: "glow" as const };
  if (!bg || !bg.value) return defaultRes;

  if (bg.type === "solid") {
    const rgbMatch = bg.value.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
    if (rgbMatch) {
      return { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]), mode: "solid" };
    }
    const hexMatch = bg.value.match(/#([0-9a-f]{6}|[0-9a-f]{3})/i);
    if (hexMatch) {
      const hex = hexMatch[1];
      const r = parseInt(hex.length === 3 ? hex[0] + hex[0] : hex.slice(0, 2), 16);
      const g = parseInt(hex.length === 3 ? hex[1] + hex[1] : hex.slice(2, 4), 16);
      const b = parseInt(hex.length === 3 ? hex[2] + hex[2] : hex.slice(4, 6), 16);
      return { r, g, b, mode: "solid" };
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
      const hex = hexMatch[1];
      const r = parseInt(hex.length === 3 ? hex[0] + hex[0] : hex.slice(0, 2), 16);
      const g = parseInt(hex.length === 3 ? hex[1] + hex[1] : hex.slice(2, 4), 16);
      const b = parseInt(hex.length === 3 ? hex[2] + hex[2] : hex.slice(4, 6), 16);
      return { r, g, b, mode: "glow" };
    }
  }

  return defaultRes;
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export default function BackgroundEditor({
  background,
  onChange,
}: {
  background: AppBackground;
  onChange: (background: AppBackground) => void;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // RGB Editor State (defaults to the original Midnight Navy: R:10, G:14, B:41)
  const [r, setR] = useState(10);
  const [g, setG] = useState(14);
  const [b, setB] = useState(41);
  const [colorMode, setColorMode] = useState<"glow" | "solid">("glow");

  // Sync RGB state from background whenever modal opens or background changes externally
  useEffect(() => {
    if (background) {
      const parsed = extractColorFromBackground(background);
      setR(parsed.r);
      setG(parsed.g);
      setB(parsed.b);
      setColorMode(parsed.mode);
    }
  }, [background, open]);

  const update = (next: AppBackground) => {
    onChange(next);
    try {
      localStorage.setItem("frosted_background", JSON.stringify(next));
    } catch {}
  };

  const applyRgb = (newR: number, newG: number, newB: number, newMode: "glow" | "solid" = colorMode) => {
    const clampedR = Math.max(0, Math.min(255, newR));
    const clampedG = Math.max(0, Math.min(255, newG));
    const clampedB = Math.max(0, Math.min(255, newB));

    setR(clampedR);
    setG(clampedG);
    setB(clampedB);
    setColorMode(newMode);

    if (newMode === "glow") {
      update({
        type: "gradient",
        value: `radial-gradient(circle at 50% 50%, rgb(${clampedR}, ${clampedG}, ${clampedB}) 0%, #03040c 100%)`
      });
    } else {
      update({
        type: "solid",
        value: `rgb(${clampedR}, ${clampedG}, ${clampedB})`
      });
    }
  };

  const handleHexChange = (hex: string) => {
    const cleanHex = hex.replace("#", "");
    if (/^[0-9a-fA-F]{6}$/.test(cleanHex)) {
      const parsedR = parseInt(cleanHex.slice(0, 2), 16);
      const parsedG = parseInt(cleanHex.slice(2, 4), 16);
      const parsedB = parseInt(cleanHex.slice(4, 6), 16);
      applyRgb(parsedR, parsedG, parsedB, colorMode);
    }
  };

  const handleImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => update({ type: "image", value: String(reader.result) });
    reader.readAsDataURL(file);
  };

  const currentHex = rgbToHex(r, g, b);
  const isDefaultNavy = r === 10 && g === 14 && b === 41 && colorMode === "glow";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Edit background"
        title="Edit background"
        className="fixed bottom-5 left-5 z-30 flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-black/60 text-white shadow-xl backdrop-blur-xl transition-all hover:bg-white/10 hover:scale-105 active:scale-95"
      >
        <Palette size={18} className="text-white/90" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/85 p-4 sm:items-center"
            onClick={() => setOpen(false)}
          >
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-labelledby="background-editor-title"
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0e0e12] p-5 sm:p-6 text-white shadow-2xl custom-scrollbar"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-indigo-400" />
                  <h2 id="background-editor-title" className="text-sm font-bold tracking-tight">
                    Background & Theme Editor
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white transition-colors"
                  aria-label="Close background editor"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex flex-col gap-4">
                {/* Dedicated Custom RGB Color Editor */}
                <div className="rounded-xl border border-indigo-500/20 bg-gradient-to-b from-indigo-950/20 to-transparent p-3.5 sm:p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Sliders size={15} className="text-indigo-400" />
                      <div>
                        <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                          RGB Color Editor
                          {!isDefaultNavy && (
                            <span className="text-[9px] font-medium text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/50">
                              Custom
                            </span>
                          )}
                          {isDefaultNavy && (
                            <span className="text-[9px] font-medium text-blue-400 bg-blue-950/60 px-1.5 py-0.5 rounded border border-blue-800/50">
                              Navy Blue
                            </span>
                          )}
                        </h3>
                        <p className="text-[10px] text-neutral-400">
                          Replace the default navy blue with your custom RGB shade
                        </p>
                      </div>
                    </div>

                    {/* Mode Switcher: Glow vs Solid */}
                    <div className="flex rounded-lg bg-black/40 p-0.5 border border-white/10 text-[10px]">
                      <button
                        type="button"
                        onClick={() => applyRgb(r, g, b, "glow")}
                        className={`flex items-center gap-1 px-2 py-1 rounded font-medium transition-all ${
                          colorMode === "glow"
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "text-neutral-400 hover:text-neutral-200"
                        }`}
                        title="Ambient Radial Glow (like default navy blue)"
                      >
                        <SunMedium size={11} />
                        <span>Glow</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => applyRgb(r, g, b, "solid")}
                        className={`flex items-center gap-1 px-2 py-1 rounded font-medium transition-all ${
                          colorMode === "solid"
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "text-neutral-400 hover:text-neutral-200"
                        }`}
                        title="Full Solid Background"
                      >
                        <Paintbrush size={11} />
                        <span>Solid</span>
                      </button>
                    </div>
                  </div>

                  {/* Color Swatch & Preview Banner */}
                  <div className="flex items-center gap-3 mb-3.5 p-2 rounded-lg bg-black/50 border border-white/5">
                    <div
                      className="h-9 w-12 rounded-md border border-white/20 shadow-inner flex-shrink-0 transition-colors"
                      style={{
                        background: colorMode === "glow"
                          ? `radial-gradient(circle at 50% 50%, rgb(${r}, ${g}, ${b}) 0%, #03040c 100%)`
                          : `rgb(${r}, ${g}, ${b})`
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-bold text-neutral-200 uppercase">
                          {currentHex}
                        </span>
                        <span className="text-[10px] font-mono text-neutral-400">
                          rgb({r}, {g}, {b})
                        </span>
                      </div>
                      <div className="text-[10px] text-neutral-400 truncate">
                        {colorMode === "glow" ? "Ambient radial center color" : "Solid canvas color"}
                      </div>
                    </div>
                    <input
                      type="color"
                      value={currentHex}
                      onChange={(e) => handleHexChange(e.target.value)}
                      title="Native Color Picker"
                      className="h-7 w-7 cursor-pointer rounded bg-transparent border border-white/10"
                    />
                  </div>

                  {/* RGB Sliders */}
                  <div className="space-y-2.5">
                    {/* Red Slider */}
                    <div className="flex items-center gap-2.5">
                      <span className="w-4 text-xs font-bold text-red-400">R</span>
                      <input
                        type="range"
                        min={0}
                        max={255}
                        value={r}
                        onChange={(e) => applyRgb(Number(e.target.value), g, b, colorMode)}
                        className="flex-1 h-1.5 cursor-pointer appearance-none rounded-lg bg-red-950/60 accent-red-500"
                      />
                      <input
                        type="number"
                        min={0}
                        max={255}
                        value={r}
                        onChange={(e) => applyRgb(Number(e.target.value) || 0, g, b, colorMode)}
                        className="w-12 rounded bg-black/60 border border-white/10 px-1.5 py-0.5 text-right font-mono text-xs text-red-300 focus:outline-none focus:border-red-500"
                      />
                    </div>

                    {/* Green Slider */}
                    <div className="flex items-center gap-2.5">
                      <span className="w-4 text-xs font-bold text-emerald-400">G</span>
                      <input
                        type="range"
                        min={0}
                        max={255}
                        value={g}
                        onChange={(e) => applyRgb(r, Number(e.target.value), b, colorMode)}
                        className="flex-1 h-1.5 cursor-pointer appearance-none rounded-lg bg-emerald-950/60 accent-emerald-500"
                      />
                      <input
                        type="number"
                        min={0}
                        max={255}
                        value={g}
                        onChange={(e) => applyRgb(r, Number(e.target.value) || 0, b, colorMode)}
                        className="w-12 rounded bg-black/60 border border-white/10 px-1.5 py-0.5 text-right font-mono text-xs text-emerald-300 focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    {/* Blue Slider */}
                    <div className="flex items-center gap-2.5">
                      <span className="w-4 text-xs font-bold text-blue-400">B</span>
                      <input
                        type="range"
                        min={0}
                        max={255}
                        value={b}
                        onChange={(e) => applyRgb(r, g, Number(e.target.value), colorMode)}
                        className="flex-1 h-1.5 cursor-pointer appearance-none rounded-lg bg-blue-950/60 accent-blue-500"
                      />
                      <input
                        type="number"
                        min={0}
                        max={255}
                        value={b}
                        onChange={(e) => applyRgb(r, g, Number(e.target.value) || 0, colorMode)}
                        className="w-12 rounded bg-black/60 border border-white/10 px-1.5 py-0.5 text-right font-mono text-xs text-blue-300 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  {/* Quick Color Swatches */}
                  <div className="mt-3 pt-2.5 border-t border-white/5">
                    <p className="text-[9px] font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
                      Quick Color Presets
                    </p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {RGB_PRESETS.map((preset) => {
                        const isSelected = r === preset.r && g === preset.g && b === preset.b;
                        return (
                          <button
                            key={preset.name}
                            type="button"
                            onClick={() => applyRgb(preset.r, preset.g, preset.b, colorMode)}
                            title={`${preset.name} (R:${preset.r} G:${preset.g} B:${preset.b})`}
                            className={`flex items-center gap-1.5 p-1 rounded-md border text-left text-[10px] transition-all ${
                              isSelected
                                ? "border-indigo-400 bg-indigo-950/40 text-white font-semibold ring-1 ring-indigo-400/40"
                                : "border-white/5 bg-black/40 text-neutral-300 hover:border-white/20 hover:text-white"
                            }`}
                          >
                            <span
                              className="h-3 w-3 rounded-full flex-shrink-0 border border-white/20"
                              style={{ backgroundColor: `rgb(${preset.r}, ${preset.g}, ${preset.b})` }}
                            />
                            <span className="truncate">{preset.name.split(" ")[0]}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Preset Ambient Themes */}
                <div>
                  <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest text-neutral-400">
                    Curated Gradient Themes
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {THEME_PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        title={preset.name}
                        aria-label={`Use ${preset.name} background`}
                        onClick={() => update({ type: preset.type, value: preset.value })}
                        className={`group relative h-9 w-full rounded-xl border transition-all duration-150 ${
                          background.value === preset.value
                            ? "border-white ring-2 ring-indigo-500/50 scale-95"
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
                  className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-2.5 text-left text-xs text-neutral-200 hover:bg-white/[0.06] hover:border-white/15 transition-all"
                >
                  <div className="flex items-center gap-2.5">
                    <ImagePlus size={16} className="text-indigo-400" />
                    <div className="flex flex-col">
                      <span className="font-bold">Custom Image Background</span>
                      <span className="text-[10px] text-neutral-400">Upload your own wallpaper or picture</span>
                    </div>
                  </div>
                </button>
                <input ref={inputRef} type="file" accept="image/*" onChange={handleImage} className="sr-only" />

                {/* Reset to Default */}
                <button
                  type="button"
                  onClick={() => {
                    update(DEFAULT_BACKGROUND);
                    setR(10);
                    setG(14);
                    setB(41);
                    setColorMode("glow");
                  }}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-white/5 bg-white/[0.01] py-2 text-xs font-semibold text-neutral-400 hover:bg-white/[0.04] hover:text-white transition-all"
                >
                  <RotateCcw size={13} />
                  <span>Reset to Default (Midnight Navy)</span>
                </button>
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
