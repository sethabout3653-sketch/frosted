import React, { useState, useEffect } from "react";
import { X, Check, RotateCcw, SlidersHorizontal, Sparkles, Globe, Link2, Type } from "lucide-react";
import { TAB_CLOAKS, TabCloak, applyTabCloak, getSavedTabCloak, resetTabCloak, ActiveCloakState } from "../tabCloaks";
import { motion, AnimatePresence } from "motion/react";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeCloak, setActiveCloak] = useState<ActiveCloakState>(() => getSavedTabCloak());
  const [customTitle, setCustomTitle] = useState("");
  const [customIconUrl, setCustomIconUrl] = useState("");
  const [isCustomOpen, setIsCustomOpen] = useState(false);

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

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          id="settings-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-4"
        >
          <motion.div
            id="settings-modal-card"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex flex-col w-full max-w-2xl max-h-[90vh] rounded-2xl border border-indigo-900/60 bg-[#03061a] shadow-2xl shadow-black/80 text-white overflow-hidden"
          >
        {/* Header Bar */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-indigo-950/60 bg-[#05081e]">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-950/70 text-indigo-200 border border-indigo-800/50 shadow-sm animate-none">
              <SlidersHorizontal size={18} className="text-indigo-300" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Settings</h2>
              <p className="text-xs text-indigo-300/70">Tab Cloak Preferences</p>
            </div>
          </div>

          <button
            id="settings-close-btn"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-950/70 bg-[#070c28] text-indigo-300/80 hover:text-white hover:bg-[#0c1642] hover:border-indigo-700/50 transition-all duration-150 active:scale-95 cursor-pointer"
            title="Close Settings"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body - Only Tab Cloak */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Section Description & Live Browser Tab Preview */}
          <div className="rounded-xl border border-indigo-950/70 bg-[#060922]/90 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe size={15} className="text-indigo-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-indigo-200">
                  Tab Cloak
                </span>
              </div>
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 text-xs text-indigo-400/80 hover:text-indigo-200 transition-colors cursor-pointer"
                title="Reset to default Frosted tab"
              >
                <RotateCcw size={12} />
                <span>Reset to Default</span>
              </button>
            </div>

            <p className="text-xs text-indigo-200/70 leading-relaxed">
              Disguise this tab in your browser. Selecting a cloak immediately changes your browser tab&apos;s title and icon to match famous platforms with real official images and transparent backgrounds.
            </p>

            {/* Realistic Browser Tab Simulation */}
            <div className="pt-2">
              <div className="text-[10px] font-semibold text-indigo-400/70 uppercase tracking-wider mb-1.5">
                Current Browser Tab Look
              </div>
              <div className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-t-lg border-t border-x border-indigo-800/60 bg-[#090f30] text-xs font-medium text-white max-w-full sm:max-w-xs shadow-sm">
                <img
                  src={activeCloak.id === "chrome_newtab" ? "/cloaks/chrome_newtab_dark.svg" : activeCloak.icon}
                  alt="Tab Icon"
                  className="w-4 h-4 object-contain flex-shrink-0"
                  referrerPolicy="no-referrer"
                />
                <span className="truncate text-xs text-indigo-100 font-semibold">
                  {activeCloak.title}
                </span>
                <span className="ml-auto text-indigo-400/60 hover:text-indigo-200 cursor-default">
                  <X size={11} />
                </span>
              </div>
              <div className="h-[2px] w-full bg-indigo-700/50 rounded-b-sm"></div>
            </div>
          </div>

          {/* Famous Tab Cloaks Grid */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-indigo-300/80 mb-3 flex items-center justify-between">
              <span>Famous Tab Cloaks</span>
              <span className="text-[11px] font-normal text-indigo-400/60">
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
                    className={`group relative flex items-center gap-3 p-3 rounded-xl border text-left transition-all duration-150 cursor-pointer ${
                      isSelected
                        ? "border-indigo-500/80 bg-[#0c1642] shadow-lg shadow-indigo-950/50 ring-1 ring-indigo-500/50"
                        : "border-indigo-950/60 bg-[#060a24]/90 hover:bg-[#090f33] hover:border-indigo-800/50"
                    }`}
                  >
                    {/* Real Official Image with Transparent Background */}
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-transparent flex-shrink-0 transition-transform duration-150 group-hover:scale-110">
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
                        <span className="text-xs font-bold text-white truncate group-hover:text-indigo-200 transition-colors">
                          {cloak.name}
                        </span>
                        {isSelected && (
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-white flex-shrink-0 shadow-sm">
                            <Check size={10} strokeWidth={3} />
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-indigo-300/60 truncate mt-0.5">
                        {cloak.title}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Cloak Option */}
          <div className="rounded-xl border border-indigo-950/70 bg-[#060922]/90 p-4">
            <button
              onClick={() => setIsCustomOpen(!isCustomOpen)}
              className="w-full flex items-center justify-between text-left text-xs font-semibold text-indigo-200 hover:text-white transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Sparkles size={14} className="text-indigo-400" />
                Custom Tab Title & Icon
              </span>
              <span className="text-indigo-400/70 text-[11px]">
                {isCustomOpen ? "Hide options" : "Customize"}
              </span>
            </button>

            {isCustomOpen && (
              <form onSubmit={handleApplyCustom} className="mt-4 space-y-3 pt-3 border-t border-indigo-950/60">
                <div>
                  <label className="block text-[11px] font-medium text-indigo-300 mb-1 flex items-center gap-1.5">
                    <Type size={12} />
                    Custom Tab Title
                  </label>
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="e.g., Google Classroom, Canvas, or School Portal"
                    className="w-full h-8 px-3 rounded-lg border border-indigo-950/70 bg-[#070c28] text-xs text-white placeholder-indigo-300/40 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40 transition-all duration-150"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-indigo-300 mb-1 flex items-center gap-1.5">
                    <Link2 size={12} />
                    Custom Icon URL or SVG
                  </label>
                  <input
                    type="text"
                    value={customIconUrl}
                    onChange={(e) => setCustomIconUrl(e.target.value)}
                    placeholder="https://... or data:image/svg+xml;..."
                    className="w-full h-8 px-3 rounded-lg border border-indigo-950/70 bg-[#070c28] text-xs text-white placeholder-indigo-300/40 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40 transition-all duration-150"
                  />
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-lg bg-[#0c1642] hover:bg-[#122060] border border-indigo-600/60 text-indigo-100 hover:text-white font-bold text-xs transition-all duration-150 shadow-md cursor-pointer active:scale-95"
                  >
                    Apply Custom Cloak
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Footer info */}
        <div className="px-5 py-3 border-t border-indigo-950/60 bg-[#05081e] flex items-center justify-between text-[11px] text-indigo-300/60">
          <span>Preferences are automatically saved to your browser.</span>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md bg-[#0c1642] hover:bg-[#122060] border border-indigo-700/50 text-indigo-200 hover:text-white font-semibold text-xs transition-all duration-150 cursor-pointer active:scale-95"
          >
            Done
          </button>
        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
