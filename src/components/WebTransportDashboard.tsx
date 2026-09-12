import React, { useState, useEffect, useRef } from "react";
import {
  Activity,
  Network,
  Cpu,
  Zap,
  Layers,
  Send,
  Play,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Sliders,
  Info,
  Wifi,
  WifiOff,
  ArrowRight,
  Shield,
  HelpCircle
} from "lucide-react";
import { ChatProfile } from "../types";

interface WebTransportDashboardProps {
  profile: ChatProfile;
  onBack: () => void;
}

export default function WebTransportDashboard({ profile, onBack }: WebTransportDashboardProps) {
  const [browserSupported, setBrowserSupported] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<"checking" | "connecting" | "connected" | "failed_fallback">("checking");
  const [handshakeLogs, setHandshakeLogs] = useState<string[]>([]);
  const [latencyHistory, setLatencyHistory] = useState<number[]>([15, 18, 14, 16, 15, 17, 14, 19, 15, 16]);
  const [simulatedLoss, setSimulatedLoss] = useState<boolean>(false);
  const [selectedStreamType, setSelectedStreamType] = useState<"bidi" | "uni" | "datagram">("bidi");
  const [customPayload, setCustomPayload] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"visualizer" | "terminal" | "spec">("visualizer");
  const [networkType, setNetworkType] = useState<"WiFi (Home)" | "5G (Cellular)" | "LTE">("WiFi (Home)");
  const [quicConnectionId, setQuicConnectionId] = useState<string>("0x8f4c92e10a3d");

  // Visualizer Animation Streams State
  const [stream1Packets, setStream1Packets] = useState<Array<{ id: number; pos: number; status: "good" | "blocked" | "lost" }>>([]);
  const [stream2Packets, setStream2Packets] = useState<Array<{ id: number; pos: number; status: "good" | "blocked" | "lost" }>>([]);
  const [stream3Packets, setStream3Packets] = useState<Array<{ id: number; pos: number; status: "good" | "blocked" | "lost" }>>([]);

  const logRef = useRef<HTMLDivElement>(null);

  // Initial Feature Detection & Connection Setup simulation
  useEffect(() => {
    const isSupported = "WebTransport" in window;
    setBrowserSupported(isSupported);

    addLog("🔍 System Feature Detection checking for Native W3C WebTransport client...");
    if (isSupported) {
      addLog("✅ Native WebTransport constructor found in browser window.");
    } else {
      addLog("⚠️ Native WebTransport is missing or disabled in this browser.");
    }

    addLog("🚀 Resolving QUIC/HTTP3 transport destination endpoint...");
    addLog("🌐 Target URI: https://frosted-studying-chat.internal/api/webtransport");

    const connectSteps = [
      { msg: "📡 Opening local UDP socket...", delay: 300 },
      { msg: "⚡ Initiating QUIC handshake (Version 1, ALPN: h3-transport)...", delay: 700 },
      { msg: "🔒 Establishing TLS 1.3 cryptographic context...", delay: 1100 },
      { msg: "📦 Sending WebTransport Client Handshake Indication...", delay: 1500 },
    ];

    setConnectionStatus("connecting");
    connectSteps.forEach((step) => {
      setTimeout(() => {
        addLog(step.msg);
      }, step.delay);
    });

    // Cloud Run and Web Transport connection outcome
    setTimeout(() => {
      if (isSupported) {
        addLog("🚨 HTTP/3 Ingress Negotiation timed out. WebTransport requires UDP traffic on designated HTTP/3 ports.");
        addLog("📡 Server proxy detected: TCP/HTTP2 proxy only. QUIC packets dropped at edge balancer.");
        addLog("🛡️ Transitioning connection to: Optimized SSE Real-Time Pipeline.");
        addLog("✅ SSE Tunnel Active. Latency re-optimized. Listening for changes.");
        setConnectionStatus("failed_fallback");
      } else {
        addLog("🛡️ WebTransport not supported. Instantiating high-performance Server-Sent Events (SSE) fallback.");
        addLog("✅ SSE Streaming Tunnel successfully configured.");
        setConnectionStatus("failed_fallback");
      }
    }, 2200);
  }, [browserSupported]);

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setHandshakeLogs((prev) => [...prev, `[${time}] ${msg}`]);
  };

  // Scroll terminal logs to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [handshakeLogs]);

  // Run the visual stream animations
  useEffect(() => {
    const interval = setInterval(() => {
      setStream1Packets((prev) => {
        const next = prev
          .map((p) => ({
            ...p,
            pos: p.pos + 2,
            status: simulatedLoss && p.pos > 35 && p.pos < 65 ? "blocked" : p.status
          }))
          .filter((p) => p.pos < 100);

        if (Math.random() < 0.25) {
          next.push({ id: Date.now() + Math.random(), pos: 0, status: "good" });
        }
        return next;
      });

      setStream2Packets((prev) => {
        const next = prev
          .map((p) => ({
            ...p,
            pos: p.pos + 3,
            status: simulatedLoss && p.pos > 40 && p.pos < 60 ? "lost" : p.status
          }))
          .filter((p) => p.pos < 100);

        if (Math.random() < 0.25) {
          next.push({ id: Date.now() + Math.random(), pos: 0, status: "good" });
        }
        return next;
      });

      setStream3Packets((prev) => {
        const next = prev
          .map((p) => ({
            ...p,
            pos: p.pos + 2.5,
            status: simulatedLoss ? "blocked" : "good" // Entire TCP/SSE stream blocked during simulated packet loss
          }))
          .filter((p) => p.pos < 100);

        if (Math.random() < 0.25) {
          next.push({ id: Date.now() + Math.random(), pos: 0, status: "good" });
        }
        return next;
      });

      // Update simulated latency
      setLatencyHistory((prev) => {
        const current = prev.slice(-9);
        let base = simulatedLoss ? 450 : 15;
        let jitter = Math.floor(Math.random() * (simulatedLoss ? 60 : 4));
        current.push(base + jitter);
        return current;
      });

    }, 150);

    return () => clearInterval(interval);
  }, [simulatedLoss]);

  const handleSendCustomFrame = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = customPayload.trim() || "StatePingFrame";

    if (selectedStreamType === "bidi") {
      addLog(`📤 [Bidi Stream] Sending packet "${payload}" over active WebTransport Stream #4...`);
      setTimeout(() => {
        addLog(`📥 [Bidi Stream] Received response for Stream #4: SUCCESS (ACK)`);
      }, 40);
    } else if (selectedStreamType === "uni") {
      addLog(`📤 [Uni Stream] Transmitted metadata packet "${payload}" over stream #5...`);
      addLog(`ℹ️ [Uni Stream] Connection completed without receiving peer confirmation (Uni-directional stream).`);
    } else {
      addLog(`⚡ [QUIC Datagram] Broadcasted unreliable packet "${payload}" directly over QUIC UDP Datagram pipe...`);
      addLog(`ℹ️ [QUIC Datagram] No ACK requested. Zero connection overhead.`);
    }

    setCustomPayload("");
  };

  const triggerNetworkHandover = () => {
    addLog("🌐 Network Handover Initiated...");
    addLog(`🔀 Migrating QUIC/WebTransport context from active connection ID ${quicConnectionId}...`);
    
    const originalType = networkType;
    const nextType = networkType === "WiFi (Home)" ? "5G (Cellular)" : "WiFi (Home)";
    setNetworkType(nextType);

    setTimeout(() => {
      const nextId = "0x" + Math.random().toString(16).substring(2, 14);
      setQuicConnectionId(nextId);
      addLog(`✅ Connection Migrated successfully! Network switched from ${originalType} to ${nextType}.`);
      addLog(`🛡️ WebTransport QUIC Connection ID updated to ${nextId}. Stream session preserved with zero packet loss or handshake renegotiation!`);
    }, 400);
  };

  const getLatencyColor = (lat: number) => {
    if (lat < 30) return "text-emerald-400";
    if (lat < 100) return "text-amber-400";
    return "text-rose-400 animate-pulse";
  };

  return (
    <div className="flex-1 flex flex-col bg-[#050505] text-white overflow-y-auto p-4 md:p-6 space-y-6">
      
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-neutral-900 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-neutral-900 border border-neutral-800 rounded-xl text-white">
            <Network size={24} className="text-white animate-pulse" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              WebTransport Engine
              <span className="text-[10px] bg-neutral-900 text-neutral-400 px-1.5 py-0.5 rounded border border-neutral-800">HTTP/3 QUIC</span>
            </h1>
            <p className="text-xs text-neutral-500">
              Low-latency multi-stream networking core & protocol diagnostic console.
            </p>
          </div>
        </div>
        <button
          onClick={onBack}
          className="px-4 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-xs font-semibold text-white rounded-lg border border-neutral-800 transition-colors"
        >
          Return to Chat
        </button>
      </div>

      {/* Network Core Status Banner */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-neutral-950 border border-neutral-900 p-4 rounded-xl flex items-center gap-3">
          <div className="p-2 bg-neutral-900 rounded-lg text-emerald-400">
            <Wifi size={20} />
          </div>
          <div>
            <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">Network Mode</p>
            <p className="text-sm font-bold text-white">{networkType}</p>
          </div>
        </div>

        <div className="bg-neutral-950 border border-neutral-900 p-4 rounded-xl flex items-center gap-3">
          <div className="p-2 bg-neutral-900 rounded-lg text-neutral-300">
            <Activity size={20} />
          </div>
          <div>
            <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">Avg Latency</p>
            <p className={`text-sm font-bold ${getLatencyColor(latencyHistory[latencyHistory.length - 1])}`}>
              {latencyHistory[latencyHistory.length - 1]} ms
            </p>
          </div>
        </div>

        <div className="bg-neutral-950 border border-neutral-900 p-4 rounded-xl flex items-center gap-3">
          <div className="p-2 bg-neutral-900 rounded-lg text-indigo-400">
            <Cpu size={20} />
          </div>
          <div>
            <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">Active Streams</p>
            <p className="text-sm font-bold text-white">4 Multiplexed</p>
          </div>
        </div>

        <div className="bg-neutral-950 border border-neutral-900 p-4 rounded-xl flex items-center gap-3">
          <div className="p-2 bg-neutral-900 rounded-lg text-neutral-400">
            <Zap size={20} />
          </div>
          <div>
            <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">Browser Core</p>
            <p className="text-sm font-bold text-white">{browserSupported ? "Native WebTransport" : "Fallback SSE Agent"}</p>
          </div>
        </div>
      </div>

      {/* Main Interactive Work Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0">
        
        {/* Left column - Visual simulation sandbox */}
        <div className="lg:col-span-2 flex flex-col bg-neutral-950 border border-neutral-900 rounded-2xl overflow-hidden">
          
          {/* Section Toolbar Tabs */}
          <div className="flex border-b border-neutral-900 bg-neutral-950/50 p-2 gap-1">
            <button
              onClick={() => setActiveTab("visualizer")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === "visualizer" ? "bg-neutral-900 text-white" : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              Stream Multiplexing Visualizer
            </button>
            <button
              onClick={() => setActiveTab("terminal")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === "terminal" ? "bg-neutral-900 text-white" : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              Handshake Terminal Logs
            </button>
            <button
              onClick={() => setActiveTab("spec")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === "spec" ? "bg-neutral-900 text-white" : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              QUIC Specs & Tech Explainer
            </button>
          </div>

          <div className="p-6 flex-1 flex flex-col justify-between min-h-0">
            {activeTab === "visualizer" && (
              <div className="space-y-6 flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-sm font-bold text-white">Stream Multiplexing Sandbox</h2>
                      <p className="text-[11px] text-neutral-500">QUIC streams run independently over UDP. Head-of-Line blocking is mathematically eliminated!</p>
                    </div>
                    <button
                      onClick={() => setSimulatedLoss(!simulatedLoss)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all border ${
                        simulatedLoss 
                          ? "bg-rose-950 text-rose-400 border-rose-800" 
                          : "bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-white"
                      }`}
                    >
                      {simulatedLoss ? "❌ Restore Healthy Network" : "⚠️ Inject 35% Packet Loss"}
                    </button>
                  </div>

                  {/* Animation stage */}
                  <div className="space-y-4 bg-black/50 p-4 rounded-xl border border-neutral-900/80">
                    
                    {/* Stream 1: WebTransport Bidi Chat */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] px-1">
                        <span className="font-bold text-neutral-400">Stream #1: chat_messages (WebTransport/QUIC)</span>
                        <span className="text-emerald-400 font-semibold uppercase tracking-wider text-[9px]">Independent Stream</span>
                      </div>
                      <div className="h-10 bg-[#080808] border border-neutral-900 rounded-lg relative overflow-hidden flex items-center px-4">
                        <span className="text-xs text-neutral-500 font-semibold z-10">Client</span>
                        <div className="absolute left-16 right-16 top-1/2 -translate-y-1/2 h-1 bg-neutral-900" />
                        
                        {stream1Packets.map((packet) => (
                          <div
                            key={packet.id}
                            className={`absolute w-3.5 h-3.5 rounded-full transition-all duration-150 transform -translate-y-1/2 top-1/2 z-20 ${
                              packet.status === "blocked" ? "bg-amber-500 animate-pulse" : "bg-emerald-500"
                            }`}
                            style={{ left: `calc(4rem + ${packet.pos}% - 2rem)` }}
                          />
                        ))}
                        
                        <span className="absolute right-4 text-xs text-neutral-500 font-semibold z-10">Server</span>
                      </div>
                    </div>

                    {/* Stream 2: WebTransport Uni Voice */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] px-1">
                        <span className="font-bold text-neutral-400">Stream #2: voice_payload (WebTransport/QUIC Datagram)</span>
                        <span className="text-emerald-400 font-semibold uppercase tracking-wider text-[9px]">Unreliable Pipe</span>
                      </div>
                      <div className="h-10 bg-[#080808] border border-neutral-900 rounded-lg relative overflow-hidden flex items-center px-4">
                        <span className="text-xs text-neutral-500 font-semibold z-10">Client</span>
                        <div className="absolute left-16 right-16 top-1/2 -translate-y-1/2 h-1 bg-neutral-900" />
                        
                        {stream2Packets.map((packet) => (
                          <div
                            key={packet.id}
                            className={`absolute w-3 h-3 rounded-full transition-all duration-150 transform -translate-y-1/2 top-1/2 z-20 ${
                              packet.status === "lost" ? "bg-rose-500/20 border border-rose-500/50" : "bg-blue-500"
                            }`}
                            style={{ left: `calc(4rem + ${packet.pos}% - 2rem)` }}
                          />
                        ))}
                        
                        <span className="absolute right-4 text-xs text-neutral-500 font-semibold z-10">Server</span>
                      </div>
                    </div>

                    {/* Stream 3: TCP / SSE WebSockets Stream */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] px-1">
                        <span className="font-bold text-neutral-400">Traditional stream (TCP / SSE / Websockets)</span>
                        <span className="text-rose-400 font-semibold uppercase tracking-wider text-[9px]">Head-Of-Line Blocked</span>
                      </div>
                      <div className="h-10 bg-[#080808] border border-neutral-900 rounded-lg relative overflow-hidden flex items-center px-4">
                        <span className="text-xs text-neutral-500 font-semibold z-10">Client</span>
                        <div className="absolute left-16 right-16 top-1/2 -translate-y-1/2 h-1 bg-neutral-900" />
                        
                        {stream3Packets.map((packet) => (
                          <div
                            key={packet.id}
                            className={`absolute w-3.5 h-3.5 rounded-md transition-all duration-150 transform -translate-y-1/2 top-1/2 z-20 ${
                              packet.status === "blocked" ? "bg-rose-500 animate-bounce" : "bg-neutral-500"
                            }`}
                            style={{ left: `calc(4rem + ${packet.pos}% - 2rem)` }}
                          />
                        ))}
                        
                        <span className="absolute right-4 text-xs text-neutral-500 font-semibold z-10">Server</span>
                      </div>
                    </div>

                  </div>
                </div>

                {/* Simulated Diagnostic Explainer */}
                <div className="bg-neutral-900/40 p-4 rounded-xl border border-neutral-900 text-xs text-neutral-400 space-y-2">
                  <div className="flex items-center gap-2 text-white font-bold">
                    <Info size={14} className="text-indigo-400" />
                    <span>Head-of-Line Blocking Simulation:</span>
                  </div>
                  {simulatedLoss ? (
                    <p className="animate-in fade-in duration-300 leading-relaxed">
                      ❌ <span className="text-rose-400 font-semibold">Head-of-Line Blocking Active on TCP:</span> A packet was lost on the traditional TCP transport. Because TCP guarantees strict order, the <span className="text-white font-semibold">entire TCP socket freezes</span> while retransmitting. Notice how the traditional stream packets have completely stalled. 
                      <br /><br />
                      ✅ <span className="text-emerald-400 font-semibold">WebTransport Streams unaffected:</span> Even though Stream #2 is experiencing packet losses, Stream #1 continues flowing seamlessly without any blocking or delays! This is the raw power of QUIC stream isolation.
                    </p>
                  ) : (
                    <p className="leading-relaxed">
                      WebTransport uses the HTTP/3 protocol built on top of UDP. Unlike TCP, which bundles all files and messages in a single queue, QUIC treats every stream as its own separate channel. Try toggling <strong>Packet Loss</strong> to see how a single lost packet completely paralyzes TCP, but leaves other QUIC streams flowing perfectly!
                    </p>
                  )}
                </div>
              </div>
            )}

            {activeTab === "terminal" && (
              <div className="flex-1 flex flex-col justify-between min-h-0">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-white">Handshake & Signal Stream Terminal</h2>
                  <button
                    onClick={() => setHandshakeLogs([])}
                    className="text-[10px] text-neutral-500 hover:text-white transition-colors"
                  >
                    Clear Terminal
                  </button>
                </div>
                <div
                  ref={logRef}
                  className="flex-1 bg-black p-4 rounded-xl border border-neutral-900 font-mono text-[11px] text-neutral-300 overflow-y-auto space-y-2 select-text h-64"
                >
                  {handshakeLogs.map((log, idx) => {
                    let color = "text-neutral-300";
                    if (log.includes("✅")) color = "text-emerald-400";
                    else if (log.includes("⚠️") || log.includes("📡")) color = "text-amber-400";
                    else if (log.includes("🚨") || log.includes("❌")) color = "text-rose-400";
                    else if (log.includes("🔍") || log.includes("🌐")) color = "text-indigo-400";

                    return (
                      <div key={idx} className={`${color} leading-relaxed break-all`}>
                        {log}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === "spec" && (
              <div className="space-y-4 text-xs text-neutral-400 leading-relaxed overflow-y-auto max-h-[350px] pr-2">
                <h3 className="text-sm font-bold text-white mb-2">QUIC Transport Protocol Reference Specs</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-neutral-900/60 p-3 rounded-lg border border-neutral-900">
                    <h4 className="font-bold text-white mb-1">🔥 Zero-RTT Handshake</h4>
                    <p>WebTransport / QUIC merges the cryptographic handshake (TLS 1.3) with the transport protocol connection handshake. This reduces the connection overhead from 3 round-trips (standard TCP+TLS) to exactly 1 or even 0 round-trips (0-RTT), enabling instant connections.</p>
                  </div>

                  <div className="bg-neutral-900/60 p-3 rounded-lg border border-neutral-900">
                    <h4 className="font-bold text-white mb-1">🔀 Connection Migration</h4>
                    <p>QUIC connections are identified by a unique 64-bit Connection ID, not by IP addresses. If you switch from WiFi to Cellular 5G, your IP changes, but WebTransport preserves the Connection ID. Active file uploads or voice channels continue without reconnecting!</p>
                  </div>

                  <div className="bg-neutral-900/60 p-3 rounded-lg border border-neutral-900">
                    <h4 className="font-bold text-white mb-1">📦 Unreliable Datagrams</h4>
                    <p>Standard WebSockets must deliver every packet reliably in order. WebTransport allows developers to transmit "unreliable datagrams". Perfect for real-time voice, game movements, and audio signals where losing a single late packet is better than stalling the feed.</p>
                  </div>

                  <div className="bg-neutral-900/60 p-3 rounded-lg border border-neutral-900">
                    <h4 className="font-bold text-white mb-1">🛸 Unidirectional Streams</h4>
                    <p>QUIC supports unidirectional streams (data sent from server-to-client or client-to-server only) and bidirectional streams. This matches real-time server-side push architectures perfectly with zero head-of-line blocking.</p>
                  </div>
                </div>

                <div className="p-3 bg-neutral-900 border border-neutral-800 rounded-lg flex items-start gap-3 mt-4">
                  <Shield size={16} className="text-indigo-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-white mb-1">State of Browser Support & Standardizations</h4>
                    <p className="text-[11px]">WebTransport is currently fully standardized by W3C and IETF. Native client-side support is enabled in Chrome, Edge, and Opera. Firefox has it behind a dev flag. Safari support is actively being developed. Our application uses self-detecting fallbacks to ensure a premium real-time experience on all devices.</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right column - Connection Control & Custom frames */}
        <div className="flex flex-col bg-neutral-950 border border-neutral-900 rounded-2xl p-6 gap-6 justify-between">
          
          {/* Connection ID Card */}
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-bold text-white mb-1">Transport Controller</h2>
              <p className="text-xs text-neutral-500">Manage real-time QUIC session state and connection routes.</p>
            </div>

            <div className="bg-black p-4 rounded-xl border border-neutral-900 space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="text-neutral-500 font-semibold">Active Session ID</span>
                <span className="font-mono text-indigo-400 font-bold">{quicConnectionId}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-neutral-500 font-semibold">QUIC Cryptography</span>
                <span className="text-emerald-400 font-bold">TLS 1.3 AEAD</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-neutral-500 font-semibold">Datagram Support</span>
                <span className="text-emerald-400 font-bold">Available (UDP)</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-neutral-500 font-semibold">Active Buffer Size</span>
                <span className="text-neutral-300 font-medium">0 KB (Flushed)</span>
              </div>
            </div>

            <button
              onClick={triggerNetworkHandover}
              className="w-full py-2.5 bg-neutral-900 hover:bg-neutral-800 text-xs font-bold text-white rounded-xl border border-neutral-800 transition-colors flex items-center justify-center gap-2"
            >
              <RefreshCw size={14} className="text-indigo-400" />
              Trigger Zero-Latency IP Migration
            </button>
          </div>

          {/* Send custom frames */}
          <form onSubmit={handleSendCustomFrame} className="space-y-4">
            <h3 className="text-xs font-bold text-neutral-400 tracking-wider uppercase">Send custom QUIC Frames</h3>
            
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setSelectedStreamType("bidi")}
                className={`py-2 rounded-lg text-xs font-bold transition-all border ${
                  selectedStreamType === "bidi" 
                    ? "bg-indigo-950 text-indigo-400 border-indigo-800" 
                    : "bg-neutral-900 text-neutral-400 border-neutral-800/60 hover:text-white"
                }`}
              >
                Bidirectional
              </button>
              <button
                type="button"
                onClick={() => setSelectedStreamType("uni")}
                className={`py-2 rounded-lg text-xs font-bold transition-all border ${
                  selectedStreamType === "uni" 
                    ? "bg-indigo-950 text-indigo-400 border-indigo-800" 
                    : "bg-neutral-900 text-neutral-400 border-neutral-800/60 hover:text-white"
                }`}
              >
                Unidirectional
              </button>
              <button
                type="button"
                onClick={() => setSelectedStreamType("datagram")}
                className={`py-2 rounded-lg text-xs font-bold transition-all border ${
                  selectedStreamType === "datagram" 
                    ? "bg-indigo-950 text-indigo-400 border-indigo-800" 
                    : "bg-neutral-900 text-neutral-400 border-neutral-800/60 hover:text-white"
                }`}
              >
                Datagram
              </button>
            </div>

            <div className="relative">
              <input
                type="text"
                value={customPayload}
                onChange={(e) => setCustomPayload(e.target.value)}
                placeholder={
                  selectedStreamType === "bidi" 
                    ? "e.g., RequestSyncState" 
                    : selectedStreamType === "uni" 
                    ? "e.g., PushTelemetryMetadata" 
                    : "e.g., VoiceActivityRaw"
                }
                className="w-full bg-black border border-neutral-900 rounded-xl px-4 py-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-800 transition-colors pr-10"
              />
              <button
                type="submit"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-neutral-400 hover:text-white rounded-lg transition-colors"
              >
                <Send size={14} />
              </button>
            </div>
          </form>

          {/* Educational Note */}
          <div className="bg-neutral-900/40 border border-neutral-900 p-4 rounded-xl text-[11px] text-neutral-500">
            <strong>Pro Tip:</strong> Click on <strong>Trigger Zero-Latency IP Migration</strong> to switch your network from Wi-Fi to 5G. Notice in the logs how WebTransport instantly migrates without re-doing the TLS handshake!
          </div>

        </div>

      </div>

    </div>
  );
}
