import React, { useRef, useState } from "react";
import { ImagePlus, Palette, RotateCcw, X, Sparkles } from "lucide-react";
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

export default function BackgroundEditor({
  background,
  onChange,
}: {
  background: AppBackground;
  onChange: (background: AppBackground) => void;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const update = (next: AppBackground) => {
    onChange(next);
    try {
      localStorage.setItem("frosted_background", JSON.stringify(next));
    } catch {}
  };

  const handleImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => update({ type: "image", value: String(reader.result) });
    reader.readAsDataURL(file);
  };

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
              className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0e0e11] p-6 text-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-indigo-400" />
                  <h2 id="background-editor-title" className="text-sm font-bold tracking-tight">
                    Customize App Theme
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

              <div className="flex flex-col gap-5">
                {/* Preset Ambient Themes */}
                <div>
                  <p className="mb-2.5 text-[10px] font-extrabold uppercase tracking-widest text-neutral-400">
                    Premium Presets
                  </p>
                  <div className="grid grid-cols-4 gap-2.5">
                    {THEME_PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        title={preset.name}
                        aria-label={`Use ${preset.name} background`}
                        onClick={() => update({ type: preset.type, value: preset.value })}
                        className={`group relative h-10 w-full rounded-xl border transition-all duration-150 ${
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

                {/* Custom Solid Color Picker */}
                <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] p-3">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-neutral-200">Custom Color</span>
                    <span className="text-[10px] text-neutral-400">Pick any custom solid shade</span>
                  </div>
                  <input
                    type="color"
                    value={background.type === "solid" ? background.value : "#050505"}
                    onChange={(e) => update({ type: "solid", value: e.target.value })}
                    className="h-8 w-14 cursor-pointer rounded-lg bg-transparent border border-white/10"
                  />
                </div>

                {/* Custom Picture Uploader */}
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-3 text-left text-xs text-neutral-200 hover:bg-white/[0.06] hover:border-white/15 transition-all"
                >
                  <div className="flex items-center gap-2.5">
                    <ImagePlus size={16} className="text-indigo-400" />
                    <div className="flex flex-col">
                      <span className="font-bold">Custom Image Background</span>
                      <span className="text-[10px] text-neutral-400">Upload your own static picture</span>
                    </div>
                  </div>
                </button>
                <input ref={inputRef} type="file" accept="image/*" onChange={handleImage} className="sr-only" />

                {/* Reset to Default */}
                <button
                  type="button"
                  onClick={() => update(DEFAULT_BACKGROUND)}
                  className="mt-1 flex items-center justify-center gap-1.5 rounded-xl border border-white/5 bg-white/[0.01] py-2.5 text-xs font-semibold text-neutral-400 hover:bg-white/[0.04] hover:text-white transition-all"
                >
                  <RotateCcw size={13} />
                  <span>Reset to Default Theme</span>
                </button>
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
