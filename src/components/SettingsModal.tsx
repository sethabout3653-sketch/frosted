import React, { useState, useEffect, useRef } from "react";
import {
  X,
  Check,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Globe,
  Link2,
  Type,
  Volume2,
  VolumeX,
  Play,
  Square,
  Upload,
  Music,
  Bell,
} from "lucide-react";
import { TAB_CLOAKS, TabCloak, applyTabCloak, getSavedTabCloak, resetTabCloak, ActiveCloakState } from "../tabCloaks";
import { playIncomingRingtone, stopIncomingRingtone } from "../utils/callSounds";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<"cloaks" | "sounds">("cloaks");

  // Tab Cloak states
  const [activeCloak, setActiveCloak] = useState<ActiveCloakState>(() => getSavedTabCloak());
  const [customTitle, setCustomTitle] = useState("");
  const [customIconUrl, setCustomIconUrl] = useState("");
  const [isCustomOpen, setIsCustomOpen] = useState(false);

  // Ringtone states
  const [ringtoneType, setRingtoneType] = useState<string>(() => {
    return localStorage.getItem("custom_ringtone_type") || "default";
  });
  const [customRingtoneUrl, setCustomRingtoneUrl] = useState<string>(() => {
    return localStorage.getItem("custom_ringtone_url") || "";
  });
  const [customRingtoneFileName, setCustomRingtoneFileName] = useState<string>(() => {
    return localStorage.getItem("custom_ringtone_filename") || "";
  });
  const [ringtoneVolume, setRingtoneVolume] = useState<number>(() => {
    return parseFloat(localStorage.getItem("custom_ringtone_volume") || "0.85");
  });
  const [isPlayingPreview, setIsPlayingPreview] = useState<boolean>(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const stopPreview = () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
      previewAudioRef.current = null;
    }
    stopIncomingRingtone();
    setIsPlayingPreview(false);
  };

  // Sync state when modal opens
  useEffect(() => {
    if (isOpen) {
      const current = getSavedTabCloak();
      setActiveCloak(current);
      if (current.id === "custom") {
        setCustomTitle(current.title);
        setCustomIconUrl(current.icon);
        setIsCustomOpen(true);
      }
      setRingtoneType(localStorage.getItem("custom_ringtone_type") || "default");
      setCustomRingtoneUrl(localStorage.getItem("custom_ringtone_url") || "");
      setCustomRingtoneFileName(localStorage.getItem("custom_ringtone_filename") || "");
      setRingtoneVolume(parseFloat(localStorage.getItem("custom_ringtone_volume") || "0.85"));
    } else {
      stopPreview();
    }
  }, [isOpen]);

  // Handle ESC key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSelectCloak = (cloak: TabCloak) => {
    const nextState = {
      id: cloak.id,
      title: cloak.title,
      icon: cloak.iconUrl,
    };
    applyTabCloak(nextState);
    setActiveCloak(nextState);
  };

  const handleApplyCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTitle.trim()) return;
    const nextState = {
      id: "custom",
      title: customTitle.trim(),
      icon: customIconUrl.trim() || "/favicon.svg",
    };
    applyTabCloak(nextState);
    setActiveCloak(nextState);
  };

  const handleReset = () => {
    resetTabCloak();
    const def = getSavedTabCloak();
    setActiveCloak(def);
    setCustomTitle("");
    setCustomIconUrl("");
  };

  // Ringtone updates
  const handleSelectRingtone = (type: string) => {
    stopPreview();
    setRingtoneType(type);
    localStorage.setItem("custom_ringtone_type", type);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 6 * 1024 * 1024) {
      alert("Audio file is too large. Please choose an audio clip under 6MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      try {
        localStorage.setItem("custom_ringtone_data", result);
        localStorage.setItem("custom_ringtone_filename", file.name);
        localStorage.setItem("custom_ringtone_type", "custom_file");
        setCustomRingtoneFileName(file.name);
        setRingtoneType("custom_file");
      } catch (storageErr) {
        alert("Could not save audio file to browser storage. Try a smaller MP3 or a URL.");
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveCustomUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customRingtoneUrl.trim()) return;
    localStorage.setItem("custom_ringtone_url", customRingtoneUrl.trim());
    localStorage.setItem("custom_ringtone_type", "custom_url");
    setRingtoneType("custom_url");
  };

  const handleVolumeChange = (vol: number) => {
    setRingtoneVolume(vol);
    localStorage.setItem("custom_ringtone_volume", vol.toString());
    if (previewAudioRef.current) {
      previewAudioRef.current.volume = vol;
    }
  };

  const handleTogglePreview = () => {
    if (isPlayingPreview) {
      stopPreview();
    } else {
      setIsPlayingPreview(true);
      playIncomingRingtone();
    }
  };

  return (
    <div
      id="settings-modal-backdrop"
      onClick={() => {
        stopPreview();
        onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-4 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div
        id="settings-modal-card"
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col w-full max-w-2xl max-h-[90vh] rounded-2xl border border-neutral-800/90 bg-[#0c0c0c]/95 backdrop-blur-2xl shadow-2xl text-white overflow-hidden transition-all"
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800/80 bg-neutral-950/40">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white border border-white/15 backdrop-blur-md shadow-sm">
              <SlidersHorizontal size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Settings</h2>
              <p className="text-xs text-neutral-400">Preferences &amp; Audio</p>
            </div>
          </div>

          <button
            id="settings-close-btn"
            onClick={() => {
              stopPreview();
              onClose();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/80 text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
            title="Close Settings"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center px-5 border-b border-neutral-800/80 bg-neutral-950/20">
          <button
            onClick={() => {
              stopPreview();
              setActiveTab("cloaks");
            }}
            className={`flex items-center gap-2 py-3 px-3 text-xs font-bold border-b-2 transition-all cursor-pointer ${
              activeTab === "cloaks"
                ? "border-white text-white"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Globe size={14} />
            <span>Tab Cloaks</span>
          </button>

          <button
            onClick={() => setActiveTab("sounds")}
            className={`flex items-center gap-2 py-3 px-3 text-xs font-bold border-b-2 transition-all cursor-pointer ${
              activeTab === "sounds"
                ? "border-emerald-400 text-emerald-400"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Bell size={14} />
            <span>Call Ringtone &amp; Sounds</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {activeTab === "sounds" ? (
            /* RINGTONE & SOUNDS SETTINGS */
            <div className="space-y-5">
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Music size={16} className="text-emerald-400" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
                      Incoming Call Ringtone
                    </span>
                  </div>

                  {/* Test Ringtone Button */}
                  <button
                    onClick={handleTogglePreview}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer shadow ${
                      isPlayingPreview
                        ? "bg-rose-600 hover:bg-rose-500 text-white animate-pulse"
                        : "bg-emerald-600 hover:bg-emerald-500 text-white"
                    }`}
                  >
                    {isPlayingPreview ? (
                      <>
                        <Square size={12} className="fill-white" />
                        <span>Stop Ringtone</span>
                      </>
                    ) : (
                      <>
                        <Play size={12} className="fill-white" />
                        <span>Test Ringtone</span>
                      </>
                    )}
                  </button>
                </div>

                <p className="text-xs text-neutral-400 leading-relaxed">
                  Choose or upload your custom incoming call ringtone. When a call is missed or ended, the ringtone instantly stops and plays the Discord disconnect chime.
                </p>

                {/* Volume slider */}
                <div className="pt-1 flex items-center gap-3">
                  <span className="text-xs text-neutral-400 font-medium flex items-center gap-1.5">
                    {ringtoneVolume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
                    Volume:
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={ringtoneVolume}
                    onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                    className="w-40 h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
                  />
                  <span className="text-xs text-neutral-400 font-mono">
                    {Math.round(ringtoneVolume * 100)}%
                  </span>
                </div>

                {/* Ringtone Options Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                  {[
                    { id: "default", name: "Discord Ringtone (Default)", desc: "Original Discord incoming call ringtone" },
                    { id: "discord_sound", name: "Discord Ping", desc: "Crisp Discord message chime" },
                    { id: "discord_join", name: "Discord Connect Chime", desc: "Discord channel join sound" },
                    { id: "lock_chime", name: "Lock Chime", desc: "Discord disconnect / lock sound" },
                  ].map((item) => {
                    const isSelected = ringtoneType === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectRingtone(item.id)}
                        className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          isSelected
                            ? "border-emerald-500 bg-emerald-950/20 text-white shadow-sm"
                            : "border-neutral-800 bg-neutral-900/40 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-900/80"
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded-full border mt-0.5 flex items-center justify-center flex-shrink-0 ${
                            isSelected
                              ? "border-emerald-500 bg-emerald-500 text-black"
                              : "border-neutral-600"
                          }`}
                        >
                          {isSelected && <Check size={10} strokeWidth={3} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold text-white">{item.name}</div>
                          <div className="text-[11px] text-neutral-400 mt-0.5">{item.desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Custom Audio Upload Section */}
                <div className="pt-3 border-t border-neutral-800 space-y-3">
                  <div className="text-xs font-bold text-white flex items-center gap-2">
                    <Upload size={14} className="text-emerald-400" />
                    <span>Upload Your Own Ringtone (.mp3, .wav, .ogg)</span>
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                    <label className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-xs font-bold text-white transition-all cursor-pointer shadow-sm">
                      <Upload size={13} />
                      <span>Choose Audio File</span>
                      <input
                        type="file"
                        accept="audio/*"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                    </label>

                    {customRingtoneFileName && (
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-950/30 border border-emerald-800 text-xs text-emerald-300">
                        <Music size={12} />
                        <span className="truncate max-w-[220px]">{customRingtoneFileName}</span>
                        {ringtoneType === "custom_file" && (
                          <span className="ml-auto text-[10px] font-bold uppercase text-emerald-400">
                            Active
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Or Custom Audio URL */}
                  <form onSubmit={handleSaveCustomUrl} className="pt-2 space-y-2">
                    <label className="block text-[11px] font-medium text-neutral-400 flex items-center gap-1.5">
                      <Link2 size={12} />
                      Or use a Custom Audio URL (Direct MP3 / Audio link)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={customRingtoneUrl}
                        onChange={(e) => setCustomRingtoneUrl(e.target.value)}
                        placeholder="https://example.com/my-ringtone.mp3"
                        className="flex-1 h-8 px-3 rounded-lg border border-neutral-800 bg-neutral-900 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                      />
                      <button
                        type="submit"
                        className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors cursor-pointer"
                      >
                        Set URL
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          ) : (
            /* TAB CLOAKS SETTINGS */
            <>
              {/* Section Description & Live Browser Tab Preview */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe size={15} className="text-neutral-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
                  Tab Cloak
                </span>
              </div>
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition-colors cursor-pointer"
                title="Reset to default Frosted tab"
              >
                <RotateCcw size={12} />
                <span>Reset to Default</span>
              </button>
            </div>

            <p className="text-xs text-neutral-400 leading-relaxed">
              Disguise this tab in your browser. Selecting a cloak immediately changes your browser tab&apos;s title and icon to match famous platforms with real official images and transparent backgrounds.
            </p>

            {/* Realistic Browser Tab Simulation */}
            <div className="pt-2">
              <div className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider mb-1.5">
                Current Browser Tab Look
              </div>
              <div className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-t-lg border-t border-x border-neutral-700 bg-neutral-800/90 text-xs font-medium text-white max-w-full sm:max-w-xs shadow-sm">
                <img
                  src={activeCloak.id === "chrome_newtab" ? "/cloaks/chrome_newtab_dark.svg" : activeCloak.icon}
                  alt="Tab Icon"
                  className="w-4 h-4 object-contain flex-shrink-0"
                  referrerPolicy="no-referrer"
                />
                <span className="truncate text-xs text-neutral-200">
                  {activeCloak.title}
                </span>
                <span className="ml-auto text-neutral-500 hover:text-neutral-300 cursor-default">
                  <X size={11} />
                </span>
              </div>
              <div className="h-[2px] w-full bg-neutral-700 rounded-b-sm"></div>
            </div>
          </div>

          {/* Famous Tab Cloaks Grid */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3 flex items-center justify-between">
              <span>Famous Tab Cloaks</span>
              <span className="text-[11px] font-normal text-neutral-500">
                Click any to apply instantly
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {TAB_CLOAKS.map((cloak) => {
                const isSelected = activeCloak.id === cloak.id;
                return (
                  <button
                    key={cloak.id}
                    onClick={() => handleSelectCloak(cloak)}
                    className={`group relative flex items-center gap-3 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? "border-white/50 bg-white/10 shadow-md ring-1 ring-white/30"
                        : "border-neutral-800/90 bg-neutral-900/60 hover:bg-neutral-800/80 hover:border-neutral-700"
                    }`}
                  >
                    {/* Real Official Image with Transparent Background */}
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-transparent flex-shrink-0 transition-transform group-hover:scale-110">
                      <img
                        src={cloak.id === "chrome_newtab" ? "/cloaks/chrome_newtab_dark.svg" : cloak.iconUrl}
                        alt={cloak.name}
                        className="w-7 h-7 object-contain drop-shadow-sm"
                        loading="eager"
                        referrerPolicy="no-referrer"
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-white truncate group-hover:text-white">
                          {cloak.name}
                        </span>
                        {isSelected && (
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-black flex-shrink-0">
                            <Check size={10} strokeWidth={3} />
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-neutral-400 truncate mt-0.5">
                        {cloak.title}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Cloak Option */}
          <div className="rounded-xl border border-neutral-800/90 bg-neutral-900/40 p-4">
            <button
              onClick={() => setIsCustomOpen(!isCustomOpen)}
              className="w-full flex items-center justify-between text-left text-xs font-semibold text-neutral-300 hover:text-white transition-colors"
            >
              <span className="flex items-center gap-2">
                <Sparkles size={14} className="text-neutral-400" />
                Custom Tab Title & Icon
              </span>
              <span className="text-neutral-500 text-[11px]">
                {isCustomOpen ? "Hide options" : "Customize"}
              </span>
            </button>

            {isCustomOpen && (
              <form onSubmit={handleApplyCustom} className="mt-4 space-y-3 pt-3 border-t border-neutral-800/80">
                <div>
                  <label className="block text-[11px] font-medium text-neutral-400 mb-1 flex items-center gap-1.5">
                    <Type size={12} />
                    Custom Tab Title
                  </label>
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="e.g., Google Classroom, Canvas, or School Portal"
                    className="w-full h-8 px-3 rounded-lg border border-neutral-800 bg-neutral-900 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-white focus:ring-1 focus:ring-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-neutral-400 mb-1 flex items-center gap-1.5">
                    <Link2 size={12} />
                    Custom Icon URL or SVG
                  </label>
                  <input
                    type="text"
                    value={customIconUrl}
                    onChange={(e) => setCustomIconUrl(e.target.value)}
                    placeholder="https://... or data:image/svg+xml;..."
                    className="w-full h-8 px-3 rounded-lg border border-neutral-800 bg-neutral-900 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-white focus:ring-1 focus:ring-white"
                  />
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-lg bg-white text-black font-bold text-xs hover:bg-neutral-200 transition-colors shadow-sm cursor-pointer"
                  >
                    Apply Custom Cloak
                  </button>
                </div>
              </form>
            )}
          </div>
            </>
          )}
        </div>

        {/* Footer info */}
        <div className="px-5 py-3 border-t border-neutral-800/80 bg-neutral-950/60 flex items-center justify-between text-[11px] text-neutral-500">
          <span>Preferences are automatically saved to your browser.</span>
          <button
            onClick={() => {
              stopPreview();
              onClose();
            }}
            className="px-3 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-white font-medium transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
