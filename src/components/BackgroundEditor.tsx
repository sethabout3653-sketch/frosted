import React, { useRef, useState } from "react";
import { ImagePlus, Palette, RotateCcw, X } from "lucide-react";

export type AppBackground = { type: "solid" | "gradient" | "image"; value: string };

export const DEFAULT_BACKGROUND: AppBackground = { type: "solid", value: "#050505" };

export default function BackgroundEditor({ background, onChange }: { background: AppBackground; onChange: (background: AppBackground) => void }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const swatches = ["#050505", "#172554", "#312e81", "#3f1d5b", "#14532d", "#7c2d12"];
  const update = (next: AppBackground) => { onChange(next); try { localStorage.setItem("frosted_background", JSON.stringify(next)); } catch {} };
  const handleImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => update({ type: "image", value: String(reader.result) });
    reader.readAsDataURL(file);
  };
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-label="Edit background" title="Edit background" className="fixed bottom-4 left-4 z-30 size-10 rounded-xl border border-neutral-700 bg-black/80 text-neutral-300 shadow-xl backdrop-blur hover:bg-neutral-800 hover:text-white"><Palette size={17} className="mx-auto" /></button>
    {open && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <section role="dialog" aria-modal="true" aria-labelledby="background-editor-title" className="w-full max-w-sm rounded-2xl border border-neutral-700 bg-neutral-950 p-5 text-white shadow-2xl">
        <div className="mb-5 flex items-center justify-between"><h2 id="background-editor-title" className="font-bold">App background</h2><button type="button" onClick={() => setOpen(false)} aria-label="Close background editor"><X size={18} /></button></div>
        <div className="flex flex-col gap-4">
          <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Solid color<input type="color" value={background.type === "solid" ? background.value : "#050505"} onChange={(e) => update({ type: "solid", value: e.target.value })} className="mt-2 h-10 w-full cursor-pointer rounded-lg bg-transparent" /></label>
          <div><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">Presets</p><div className="flex flex-wrap gap-2">{swatches.map((color) => <button key={color} type="button" aria-label={`Use ${color} background`} onClick={() => update({ type: "solid", value: color })} className="size-8 rounded-full border border-white/30" style={{ backgroundColor: color }} />)}</div></div>
          <button type="button" onClick={() => update({ type: "gradient", value: "linear-gradient(135deg, #050505 0%, #312e81 52%, #0f172a 100%)" })} className="flex items-center gap-2 rounded-xl border border-neutral-700 px-3 py-2 text-left text-sm hover:bg-neutral-900"><span className="size-6 rounded-md" style={{ background: "linear-gradient(135deg,#050505,#312e81,#0f172a)" }} />Use midnight gradient</button>
          <button type="button" onClick={() => inputRef.current?.click()} className="flex items-center gap-2 rounded-xl border border-neutral-700 px-3 py-2 text-left text-sm hover:bg-neutral-900"><ImagePlus size={17} />Choose custom picture</button>
          <input ref={inputRef} type="file" accept="image/*" onChange={handleImage} className="sr-only" />
          <button type="button" onClick={() => update(DEFAULT_BACKGROUND)} className="flex items-center justify-center gap-2 rounded-xl border border-neutral-800 py-2 text-sm text-neutral-400 hover:text-white"><RotateCcw size={15} />Reset background</button>
        </div>
      </section>
    </div>}
  </>;
}
