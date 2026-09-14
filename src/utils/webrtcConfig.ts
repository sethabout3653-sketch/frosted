export type WebRTCMode = "auto" | "force_tcp_443" | "udp_only";

export interface IceCandidateInfo {
  protocol: "tcp" | "udp" | "tls" | "unknown";
  type: "host" | "srflx" | "prflx" | "relay" | "unknown";
  port: number;
  ip: string;
  isSchoolBypass: boolean; // TCP on port 443 or 80
  raw: string;
}

export interface WebRTCDiagnosticResult {
  mode: WebRTCMode;
  udpSupported: boolean;
  tcp443Supported: boolean;
  tcp80Supported: boolean;
  candidatesCount: number;
  relayCount: number;
  candidates: IceCandidateInfo[];
  latencyMs: number;
  recommendedMode: WebRTCMode;
  statusText: string;
}

// Comprehensive ICE server configuration with fallback to TCP Port 443 (HTTPS) and Port 80 (HTTP)
// School firewalls typically block random UDP ports, but allow TCP port 443 and 80.
export const SCHOOL_FIREWALL_ICE_SERVERS: RTCIceServer[] = [
  // 1. TCP Port 443 & 80 TURN Fallback Endpoints (School Bypass)
  {
    urls: [
      "turn:openrelay.metered.ca:443?transport=tcp",
      "turns:openrelay.metered.ca:443?transport=tcp",
      "turn:openrelay.metered.ca:80?transport=tcp",
    ],
    username: "openrelay",
    credential: "openrelay",
  },
  {
    urls: [
      "turn:relays.net:443?transport=tcp",
      "turn:relays.net:80?transport=tcp",
    ],
    username: "guest",
    credential: "guest",
  },
  {
    urls: [
      "stun:stun.nextcloud.com:443",
      "stun:stun.cloudflare.com:443",
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
      "stun:stun2.l.google.com:19302",
      "stun:stun3.l.google.com:19302",
      "stun:stun4.l.google.com:19302",
      "stun:global.stun.twilio.com:3478",
    ],
  },
];

export function getSavedWebRTCMode(): WebRTCMode {
  try {
    const saved = localStorage.getItem("frosted_webrtc_mode") as WebRTCMode;
    if (saved === "force_tcp_443" || saved === "udp_only" || saved === "auto") {
      return saved;
    }
  } catch {}
  return "auto";
}

export function setSavedWebRTCMode(mode: WebRTCMode): void {
  try {
    localStorage.setItem("frosted_webrtc_mode", mode);
  } catch {}
}

/**
 * Generates an RTCConfiguration object optimized for school firewall bypass.
 * If mode is 'force_tcp_443', iceTransportPolicy is set to 'relay' to mandate TCP port 443/80 traversal.
 */
export function getRTCConfiguration(overrideMode?: WebRTCMode): RTCConfiguration {
  const mode = overrideMode || getSavedWebRTCMode();

  const config: RTCConfiguration = {
    iceServers: SCHOOL_FIREWALL_ICE_SERVERS,
    iceCandidatePoolSize: 10,
    bundlePolicy: "balanced",
    rtcpMuxPolicy: "require",
  };

  if (mode === "force_tcp_443") {
    // Force Relay via TURN over TCP 443 / 80 - completely bypasses blocked UDP ports
    config.iceTransportPolicy = "relay";
  } else if (mode === "udp_only") {
    config.iceTransportPolicy = "all";
  } else {
    // 'auto' mode allows standard candidates first, but includes TCP 443/80 TURN relay candidates
    config.iceTransportPolicy = "all";
  }

  return config;
}

/**
 * Parses a raw WebRTC SDP ICE candidate string to extract transport protocol, port, type, and school bypass classification.
 */
export function parseIceCandidate(candidateStr: string): IceCandidateInfo {
  const parts = candidateStr.split(" ");
  let ip = "0.0.0.0";
  let port = 0;
  let protocol: "tcp" | "udp" | "tls" | "unknown" = "unknown";
  let type: "host" | "srflx" | "prflx" | "relay" | "unknown" = "unknown";

  try {
    if (parts.length >= 8) {
      const protoIndex = parts.findIndex((p) => p.toLowerCase() === "udp" || p.toLowerCase() === "tcp");
      if (protoIndex !== -1) {
        protocol = parts[protoIndex].toLowerCase() as any;
        ip = parts[protoIndex + 2] || ip;
        port = parseInt(parts[protoIndex + 3], 10) || 0;
      }

      const typIndex = parts.indexOf("typ");
      if (typIndex !== -1 && typIndex + 1 < parts.length) {
        type = parts[typIndex + 1].toLowerCase() as any;
      }
    }
  } catch {}

  const isSchoolBypass =
    protocol === "tcp" ||
    protocol === "tls" ||
    port === 443 ||
    port === 80 ||
    type === "relay";

  return {
    protocol,
    type,
    port,
    ip,
    isSchoolBypass,
    raw: candidateStr,
  };
}

/**
 * Runs a quick real-time test of WebRTC ICE candidate gathering over UDP and TCP 443/80.
 */
export async function runWebRTCDiagnostic(mode: WebRTCMode = "auto"): Promise<WebRTCDiagnosticResult> {
  const startTime = Date.now();
  const candidates: IceCandidateInfo[] = [];
  let udpSupported = false;
  let tcp443Supported = false;
  let tcp80Supported = false;

  return new Promise((resolve) => {
    let pc: RTCPeerConnection | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;

    const finish = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (pc) {
        try {
          pc.close();
        } catch {}
      }

      const latencyMs = Date.now() - startTime;
      const relayCount = candidates.filter((c) => c.type === "relay").length;

      let recommendedMode: WebRTCMode = "auto";
      let statusText = "WebRTC fully active";

      if (!udpSupported && (tcp443Supported || tcp80Supported || relayCount > 0)) {
        recommendedMode = "force_tcp_443";
        statusText = "UDP ports blocked by firewall. TCP port 443/80 fallback active!";
      } else if (relayCount > 0 || tcp443Supported) {
        recommendedMode = "auto";
        statusText = "WebRTC ready with automatic TCP port 443/80 school firewall fallback.";
      } else {
        statusText = "ICE candidate gathering operational.";
      }

      resolve({
        mode,
        udpSupported,
        tcp443Supported,
        tcp80Supported,
        candidatesCount: candidates.length,
        relayCount,
        candidates,
        latencyMs,
        recommendedMode,
        statusText,
      });
    };

    try {
      const config = getRTCConfiguration(mode);
      pc = new RTCPeerConnection(config);

      // Create a dummy data channel to trigger ICE gathering
      pc.createDataChannel("diagnostic_check");

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const parsed = parseIceCandidate(event.candidate.candidate);
          candidates.push(parsed);

          if (parsed.protocol === "udp") udpSupported = true;
          if (parsed.port === 443 || parsed.protocol === "tcp" || parsed.protocol === "tls") tcp443Supported = true;
          if (parsed.port === 80) tcp80Supported = true;
        } else {
          // ICE gathering completed
          finish();
        }
      };

      pc.createOffer()
        .then((offer) => pc?.setLocalDescription(offer))
        .catch(() => finish());

      // Timeout after 4 seconds
      timeoutTimer = setTimeout(finish, 4000);
    } catch {
      finish();
    }
  });
}
