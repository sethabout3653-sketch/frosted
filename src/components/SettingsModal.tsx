import React, { useState, useEffect } from "react";
import {
  X,
  Check,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Palette,
  Globe,
  Link2,
  Type,
  ChevronDown,
  Eye,
} from "lucide-react";
import {
  TAB_CLOAKS,
  TabCloak,
  applyTabCloak,
  getSavedTabCloak,
  resetTabCloak,
  ActiveCloakState,
} from "../tabCloaks";
import { motion, AnimatePresence } from "motion/react";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenTheme?: () => void;
}

export default function SettingsModal({ isOpen, onClose, onOpenTheme }: SettingsModalProps) {
  const [activeCloak, setActiveCloak] = useState<ActiveCloakState>(() => getSavedTabCloak());
  const [customTitle, setCustomTitle] = useState("");
  const [customIconUrl, setCustomIconUrl] = useState("");
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

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

  const filteredCloaks = TAB_CLOAKS.filter((c) => {
    if (selectedCategory === "all") return true;
    return c.category === selectedCategory;
  });

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          id="settings-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-3 sm:p-5"
        >
          <motion.div
            id="settings-modal-card"
            initial={{ opacity: 0, scale: 0.98, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 10 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: "var(--theme-darkest)",
              borderColor: "var(--theme-border)",
            }}
            className="relative flex flex-col w-full max-w-2xl max-h-[88vh] rounded-2xl border shadow-2xl shadow-black/80 text-white overflow-hidden"
          >
            {/* Soft Ambient Header Glow */}
            <div
              className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-28 pointer-events-none opacity-20 blur-2xl"
              style={{
                background: "radial-gradient(circle, var(--theme-accent) 0%, transparent 70%)",
              }}
            />

            {/* Header */}
            <div
              style={{
                backgroundColor: "var(--theme-surface)",
                borderColor: "var(--theme-border-subtle)",
              }}
              className="relative flex items-center justify-between px-6 py-4 border-b z-10"
            >
              <div className="flex items-center gap-3">
                <div
                  style={{
                    backgroundColor: "var(--theme-accent)",
                    borderColor: "var(--theme-border)",
                  }}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border shadow-inner"
                >
                  <SlidersHorizontal size={18} className="text-[var(--theme-text-accent)]" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white tracking-tight">
                    Workspace & Tab Preferences
                  </h2>
                  <p className="text-xs text-[var(--theme-text-muted)]">
                    Customize your study atmosphere and browser privacy
                  </p>
                </div>
              </div>

              <button
                id="settings-close-btn"
                onClick={onClose}
                style={{
                  backgroundColor: "var(--theme-surface)",
                  borderColor: "var(--theme-border-subtle)",
                }}
                className="flex h-8 w-8 items-center justify-center rounded-lg border text-neutral-400 hover:text-white hover:brightness-125 transition-all duration-150 active:scale-95 cursor-pointer"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6 z-10">
              {/* Ambiance & Color Wheel Card */}
              <div
                style={{
                  backgroundColor: "var(--theme-surface)",
                  borderColor: "var(--theme-border-subtle)",
                }}
                className="rounded-2xl border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm"
              >
                <div className="flex items-center gap-3.5">
                  <div
                    className="w-10 h-10 rounded-xl border border-white/60 shadow-md flex-shrink-0 relative overflow-hidden"
                    style={{
                      background:
                        "conic-gradient(from 0deg, #00ffff, #00ff66, #80ff00, #ffff00, #ff0000, #ff00ff, #0000ff, #00ffff)",
                    }}
                  >
                    <div className="absolute inset-0 bg-white/10 backdrop-blur-[1px]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                      <span>Color Wheel & Ambiance</span>
                      <Sparkles size={13} className="text-[var(--theme-text-accent)]" />
                    </h3>
                    <p className="text-xs text-[var(--theme-text-muted)] mt-0.5 leading-relaxed">
                      Choose any hue to softly recolor your workspace, cards, and glowing elements.
                    </p>
                  </div>
                </div>

                {onOpenTheme && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenTheme();
                    }}
                    style={{
                      backgroundColor: "var(--theme-accent)",
                      borderColor: "var(--theme-border)",
                    }}
                    className="px-4 py-2 rounded-xl border text-white font-medium text-xs transition-all duration-150 shadow-sm cursor-pointer hover:brightness-110 active:scale-95 flex items-center gap-2 self-start sm:self-center shrink-0"
                  >
                    <Palette size={14} className="text-[var(--theme-text-accent)]" />
                    <span>Tune Colors</span>
                  </button>
                )}
              </div>

              {/* Tab Cloak & Stealth Section */}
              <div
                style={{
                  backgroundColor: "var(--theme-surface)",
                  borderColor: "var(--theme-border-subtle)",
                }}
                className="rounded-2xl border p-4 sm:p-5 space-y-4 shadow-sm"
              >
                {/* Section Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Globe size={16} className="text-[var(--theme-text-accent)]" />
                    <h3 className="text-sm font-bold text-white tracking-wide">
                      Browser Tab Stealth
                    </h3>
                  </div>

                  <button
                    onClick={handleReset}
                    className="flex items-center gap-1.5 text-xs text-[var(--theme-text-muted)] hover:text-white transition-colors cursor-pointer"
                    title="Reset to default tab title and icon"
                  >
                    <RotateCcw size={12} />
                    <span>Reset to Frosted</span>
                  </button>
                </div>

                <p className="text-xs text-neutral-300 leading-relaxed">
                  Want to keep your study time private? Swap the browser tab icon and title so it
                  looks like everyday work, school portals, or productivity tools.
                </p>

                {/* Simulated Browser Chrome Tab */}
                <div className="pt-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-medium text-[var(--theme-text-muted)] flex items-center gap-1">
                      <Eye size={12} />
                      Live tab preview in your browser
                    </span>
                    <span className="text-[10px] text-emerald-400 font-medium">Active now</span>
                  </div>

                  {/* Browser Tab Shell */}
                  <div
                    style={{
                      backgroundColor: "rgba(0, 0, 0, 0.35)",
                      borderColor: "var(--theme-border-subtle)",
                    }}
                    className="p-2.5 rounded-xl border flex flex-col justify-end"
                  >
                    <div className="flex items-end">
                      <div
                        style={{
                          backgroundColor: "var(--theme-hover)",
                          borderColor: "var(--theme-border)",
                        }}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-t-lg border-t border-x text-xs text-white max-w-full sm:max-w-xs shadow-sm select-none"
                      >
                        <img
                          src={
                            activeCloak.id === "chrome_newtab"
                              ? "/cloaks/chrome_newtab_dark.svg"
                              : activeCloak.icon
                          }
                          alt="Tab Icon"
                          className="w-3.5 h-3.5 object-contain shrink-0"
                          referrerPolicy="no-referrer"
                        />
                        <span className="truncate text-xs text-white font-medium">
                          {activeCloak.title}
                        </span>
                        <span className="ml-2 text-neutral-400 opacity-60">
                          <X size={10} />
                        </span>
                      </div>
                    </div>
                    <div
                      style={{ backgroundColor: "var(--theme-border-strong)" }}
                      className="h-[1.5px] w-full rounded-full opacity-80"
                    />
                  </div>
                </div>
              </div>

              {/* Preset Cloaks */}
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-white">Popular Tab Disguises</h3>
                    <p className="text-xs text-[var(--theme-text-muted)]">
                      Click any preset to instantly update your browser tab
                    </p>
                  </div>

                  {/* Category Pills */}
                  <div className="flex items-center gap-1.5 self-start sm:self-auto overflow-x-auto pb-1 sm:pb-0">
                    {[
                      { id: "all", label: "All" },
                      { id: "google", label: "Google" },
                      { id: "school", label: "School" },
                      { id: "utility", label: "Tools" },
                    ].map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => setSelectedCategory(cat.id)}
                        style={{
                          backgroundColor:
                            selectedCategory === cat.id
                              ? "var(--theme-accent)"
                              : "var(--theme-surface)",
                          borderColor:
                            selectedCategory === cat.id
                              ? "var(--theme-border-strong)"
                              : "var(--theme-border-subtle)",
                        }}
                        className="px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-all duration-150 cursor-pointer"
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {filteredCloaks.map((cloak) => {
                    const isSelected = activeCloak.id === cloak.id;
                    return (
                      <button
                        key={cloak.id}
                        onClick={() => handleSelectCloak(cloak)}
                        style={{
                          backgroundColor: isSelected
                            ? "var(--theme-accent)"
                            : "var(--theme-surface)",
                          borderColor: isSelected
                            ? "var(--theme-border-strong)"
                            : "var(--theme-border-subtle)",
                        }}
                        className={`group relative flex items-center gap-3 p-3 rounded-xl border text-left transition-all duration-150 cursor-pointer hover:brightness-110 active:scale-[0.98] ${
                          isSelected ? "shadow-md ring-1 ring-white/20" : ""
                        }`}
                      >
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-transparent shrink-0 transition-transform duration-150 group-hover:scale-105">
                          <img
                            src={
                              cloak.id === "chrome_newtab"
                                ? "/cloaks/chrome_newtab_dark.svg"
                                : cloak.iconUrl
                            }
                            alt={cloak.name}
                            className="w-6 h-6 object-contain drop-shadow-sm"
                            loading="eager"
                            referrerPolicy="no-referrer"
                          />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-semibold text-white truncate">
                              {cloak.name}
                            </span>
                            {isSelected && (
                              <span
                                style={{ backgroundColor: "var(--theme-accent-hover)" }}
                                className="flex h-4 w-4 items-center justify-center rounded-full text-white shrink-0 shadow-sm"
                              >
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
              <div
                style={{
                  backgroundColor: "var(--theme-surface)",
                  borderColor: "var(--theme-border-subtle)",
                }}
                className="rounded-2xl border p-4 sm:p-5 transition-colors duration-200"
              >
                <button
                  onClick={() => setIsCustomOpen(!isCustomOpen)}
                  className="w-full flex items-center justify-between text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Sparkles size={15} className="text-[var(--theme-text-accent)]" />
                    <div>
                      <span className="text-sm font-semibold text-white block">
                        Create your own disguise
                      </span>
                      <span className="text-xs text-[var(--theme-text-muted)]">
                        Set a custom browser tab title or icon link
                      </span>
                    </div>
                  </div>
                  <ChevronDown
                    size={16}
                    className={`text-neutral-400 transition-transform duration-200 ${
                      isCustomOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                <AnimatePresence>
                  {isCustomOpen && (
                    <motion.form
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      onSubmit={handleApplyCustom}
                      className="mt-4 space-y-3.5 pt-3.5 border-t overflow-hidden"
                      style={{ borderColor: "var(--theme-border-subtle)" }}
                    >
                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1.5 flex items-center gap-1.5">
                          <Type size={12} className="text-[var(--theme-text-accent)]" />
                          Custom Tab Title
                        </label>
                        <input
                          type="text"
                          value={customTitle}
                          onChange={(e) => setCustomTitle(e.target.value)}
                          placeholder="e.g. Canvas Dashboard, Science Homework, or Notes"
                          style={{
                            backgroundColor: "var(--theme-darkest)",
                            borderColor: "var(--theme-border)",
                          }}
                          className="w-full h-9 px-3 rounded-xl border text-xs text-white placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-[var(--theme-border-strong)] transition-all duration-150"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-neutral-300 mb-1.5 flex items-center gap-1.5">
                          <Link2 size={12} className="text-[var(--theme-text-accent)]" />
                          Custom Favicon URL (Optional)
                        </label>
                        <input
                          type="text"
                          value={customIconUrl}
                          onChange={(e) => setCustomIconUrl(e.target.value)}
                          placeholder="https://example.com/icon.png or .ico"
                          style={{
                            backgroundColor: "var(--theme-darkest)",
                            borderColor: "var(--theme-border)",
                          }}
                          className="w-full h-9 px-3 rounded-xl border text-xs text-white placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-[var(--theme-border-strong)] transition-all duration-150"
                        />
                      </div>

                      <div className="flex justify-end pt-1">
                        <button
                          type="submit"
                          style={{
                            backgroundColor: "var(--theme-accent)",
                            borderColor: "var(--theme-border)",
                          }}
                          className="px-4 py-2 rounded-xl border text-white font-medium text-xs transition-all duration-150 shadow-sm cursor-pointer hover:brightness-110 active:scale-95"
                        >
                          Save Custom Disguise
                        </button>
                      </div>
                    </motion.form>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                backgroundColor: "var(--theme-surface)",
                borderColor: "var(--theme-border-subtle)",
              }}
              className="px-6 py-3.5 border-t flex items-center justify-between text-xs text-[var(--theme-text-muted)] z-10"
            >
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Saved automatically to your browser
              </span>
              <button
                onClick={onClose}
                style={{
                  backgroundColor: "var(--theme-accent)",
                  borderColor: "var(--theme-border)",
                }}
                className="px-4 py-1.5 rounded-xl border text-white font-medium text-xs transition-all duration-150 cursor-pointer hover:brightness-110 active:scale-95"
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
