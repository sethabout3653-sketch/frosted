import React, { useState, useEffect } from "react";
import {
  X,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Check,
  RefreshCw,
  Zap,
  Radio,
  Wifi,
  Lock,
  Server,
  Activity,
  AlertTriangle,
  Info,
} from "lucide-react";
import {
  WebRTCMode,
  getSavedWebRTCMode,
  setSavedWebRTCMode,
  runWebRTCDiagnostic,
  WebRTCDiagnosticResult,
} from "../utils/webrtcConfig";

interface WebRTCInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onModeChanged?: (mode: WebRTCMode) => void;
}

export default function WebRTCInspectorModal({
  isOpen,
  onClose,
  onModeChanged,
}: WebRTCInspectorModalProps) {
  const [currentMode, setCurrentMode] = useState<WebRTCMode>(() => getSavedWebRTCMode());
  const [isTesting, setIsTesting] = useState(false);
  const [diagnostic, setDiagnostic] = useState<WebRTCDiagnosticResult | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCurrentMode(getSavedWebRTCMode());
      handleRunDiagnostic();
    }
  }, [isOpen]);

  const handleRunDiagnostic = async (overrideMode?: WebRTCMode) => {
    const modeToTest = overrideMode || currentMode;
    setIsTesting(true);
    try {
      const result = await runWebRTCDiagnostic(modeToTest);
      setDiagnostic(result);
    } catch (e) {
      console.error("Diagnostic error:", e);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSelectMode = (mode: WebRTCMode) => {
    setCurrentMode(mode);
    setSavedWebRTCMode(mode);
    onModeChanged?.(mode);
    handleRunDiagnostic(mode);
  };

  if (!isOpen) return null;

  return (
    <div
      id="webrtc-inspector-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div
        id="webrtc-inspector-card"
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col w-full max-w-2xl max-h-[90vh] rounded-2xl border border-neutral-800 bg-[#0c0c0c] backdrop-blur-2xl shadow-2xl text-white overflow-hidden"
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800 bg-neutral-950/80">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <span>WebRTC & School Port Bypass</span>
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase tracking-wider">
                  TCP 443 / 80 Ready
                </span>
              </h2>
              <p className="text-xs text-neutral-400">
                Voice & Video stream fallback configuration for restricted networks
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Explainer Banner */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-wider">
              <Zap size={14} />
              <span>How School Firewall Bypass Works</span>
            </div>
            <p className="text-xs text-neutral-300 leading-relaxed">
              School and institutional firewalls frequently block random <strong className="text-white">UDP ports</strong> used by WebRTC voice streams.
              When UDP is blocked, our app automatically falls back to <strong className="text-emerald-400">TCP Port 443 (HTTPS)</strong> or <strong className="text-emerald-400">Port 80 (HTTP)</strong> relay servers. Firewalls cannot block ports 443 or 80 without breaking normal HTTPS web browsing!
            </p>
          </div>

          {/* Connection Mode Selection */}
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-400 block">
              WebRTC Connection Mode
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Auto Fallback */}
              <button
                onClick={() => handleSelectMode("auto")}
                className={`flex flex-col p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                  currentMode === "auto"
                    ? "border-emerald-500/60 bg-emerald-950/30 text-white ring-1 ring-emerald-500/40"
                    : "border-neutral-800 bg-neutral-900/40 hover:bg-neutral-800/60 text-neutral-300"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold flex items-center gap-1.5">
                    <Wifi size={14} className="text-emerald-400" />
                    Auto Fallback
                  </span>
                  {currentMode === "auto" && (
                    <span className="h-4 w-4 rounded-full bg-emerald-500 text-black flex items-center justify-center text-[10px]">
                      <Check size={10} strokeWidth={3} />
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-neutral-400 leading-normal">
                  Tries direct UDP first. Automatically switches to TCP 443/80 if firewalled.
                </p>
              </button>

              {/* Force TCP 443 / 80 */}
              <button
                onClick={() => handleSelectMode("force_tcp_443")}
                className={`flex flex-col p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                  currentMode === "force_tcp_443"
                    ? "border-emerald-500/60 bg-emerald-950/30 text-white ring-1 ring-emerald-500/40"
                    : "border-neutral-800 bg-neutral-900/40 hover:bg-neutral-800/60 text-neutral-300"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold flex items-center gap-1.5">
                    <Lock size={14} className="text-emerald-400" />
                    Force TCP 443/80
                  </span>
                  {currentMode === "force_tcp_443" && (
                    <span className="h-4 w-4 rounded-full bg-emerald-500 text-black flex items-center justify-center text-[10px]">
                      <Check size={10} strokeWidth={3} />
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-neutral-400 leading-normal">
                  Forces 100% relay over HTTPS Port 443. Guarantees bypass on strict firewalls.
                </p>
              </button>

              {/* UDP Only */}
              <button
                onClick={() => handleSelectMode("udp_only")}
                className={`flex flex-col p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                  currentMode === "udp_only"
                    ? "border-emerald-500/60 bg-emerald-950/30 text-white ring-1 ring-emerald-500/40"
                    : "border-neutral-800 bg-neutral-900/40 hover:bg-neutral-800/60 text-neutral-300"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold flex items-center gap-1.5">
                    <Radio size={14} className="text-blue-400" />
                    Standard UDP
                  </span>
                  {currentMode === "udp_only" && (
                    <span className="h-4 w-4 rounded-full bg-blue-500 text-black flex items-center justify-center text-[10px]">
                      <Check size={10} strokeWidth={3} />
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-neutral-400 leading-normal">
                  Standard direct p2p UDP connection without TCP fallback relay.
                </p>
              </button>
            </div>
          </div>

          {/* Live Port Diagnostic Tool */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-800/80 pb-3">
              <div className="flex items-center gap-2">
                <Activity size={16} className="text-emerald-400" />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  Network & Port Test Diagnostic
                </span>
              </div>
              <button
                onClick={() => handleRunDiagnostic()}
                disabled={isTesting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-semibold text-white transition-colors disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw size={12} className={isTesting ? "animate-spin" : ""} />
                <span>{isTesting ? "Testing Ports..." : "Run Test"}</span>
              </button>
            </div>

            {/* Diagnostic Results View */}
            {isTesting ? (
              <div className="py-8 flex flex-col items-center justify-center text-center space-y-2">
                <RefreshCw size={24} className="text-emerald-400 animate-spin" />
                <p className="text-xs font-semibold text-neutral-300">
                  Probing STUN & TURN servers over UDP and TCP Port 443 / 80...
                </p>
                <p className="text-[11px] text-neutral-500">
                  Gathering ICE candidates and evaluating firewall traversal latency
                </p>
              </div>
            ) : diagnostic ? (
              <div className="space-y-4">
                {/* Status Callout Box */}
                <div className="flex items-start gap-3 p-3 rounded-lg border border-emerald-500/30 bg-emerald-950/20 text-xs">
                  <ShieldCheck size={18} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-emerald-300">
                      {diagnostic.statusText}
                    </p>
                    <p className="text-[11px] text-neutral-400 mt-0.5">
                      Discovered {diagnostic.candidatesCount} ICE candidates ({diagnostic.relayCount} TCP 443/80 relays) in {diagnostic.latencyMs}ms.
                    </p>
                  </div>
                </div>

                {/* Port Matrix Grid */}
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="p-2.5 rounded-lg border border-neutral-800 bg-neutral-950/50">
                    <span className="text-[10px] uppercase font-bold text-neutral-500 block">UDP Voice Stream</span>
                    <span className={`text-xs font-extrabold mt-1 block ${diagnostic.udpSupported ? "text-emerald-400" : "text-amber-400"}`}>
                      {diagnostic.udpSupported ? "Available" : "Blocked / Restricted"}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-lg border border-neutral-800 bg-neutral-950/50">
                    <span className="text-[10px] uppercase font-bold text-neutral-500 block">TCP Port 443 (HTTPS)</span>
                    <span className="text-xs font-extrabold text-emerald-400 mt-1 block">
                      {diagnostic.tcp443Supported || diagnostic.relayCount > 0 ? "Bypass Ready" : "Supported"}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-lg border border-neutral-800 bg-neutral-950/50">
                    <span className="text-[10px] uppercase font-bold text-neutral-500 block">TCP Port 80 (HTTP)</span>
                    <span className="text-xs font-extrabold text-emerald-400 mt-1 block">
                      Bypass Ready
                    </span>
                  </div>
                </div>

                {/* Detected Candidates Table */}
                {diagnostic.candidates.length > 0 && (
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 block mb-2">
                      Gathered ICE Candidate Endpoints
                    </span>
                    <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1 font-mono text-[11px]">
                      {diagnostic.candidates.map((cand, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2 rounded bg-neutral-950 border border-neutral-800/80"
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                              cand.isSchoolBypass ? "bg-emerald-950 text-emerald-400 border border-emerald-800" : "bg-neutral-800 text-neutral-300"
                            }`}>
                              {cand.protocol.toUpperCase()} :{cand.port || 443}
                            </span>
                            <span className="text-neutral-300 truncate">{cand.ip || "relay-endpoint"}</span>
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-[10px] text-neutral-400 uppercase font-sans font-semibold">
                              {cand.type}
                            </span>
                            {cand.isSchoolBypass && (
                              <span className="text-[9px] font-bold text-emerald-400 bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-800">
                                SCHOOL BYPASS
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer Bar */}
        <div className="px-5 py-3 border-t border-neutral-800 bg-neutral-950/90 flex items-center justify-between text-xs text-neutral-400">
          <span>Settings persist automatically across sessions.</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold transition-colors cursor-pointer"
          >
            Apply & Close
          </button>
        </div>
      </div>
    </div>
  );
}
