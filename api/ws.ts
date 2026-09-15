// Vercel Native WebSocket Function: /api/ws
// Built for Vercel Functions Public Beta with Fluid Compute & Node.js ws fallback
// Supports direct bidirectional messaging, presence heartbeats, and WebRTC signal broadcasting

import type { IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";

// In-memory clients connected to this instance
const connectedClients = new Map<string, { socket: WebSocket; uid?: string; joinedAt: number }>();

// Global WebSocket server instance
let wss: WebSocketServer | null = null;

function getWssInstance(): WebSocketServer {
  if (!wss) {
    wss = new WebSocketServer({ noServer: true });

    wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
      const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      connectedClients.set(clientId, { socket, joinedAt: Date.now() });

      // Send initial welcome & connection confirmation
      socket.send(
        JSON.stringify({
          type: "connected",
          clientId,
          provider: "Vercel Native WebSockets (Fluid Compute)",
          timestamp: Date.now(),
        })
      );

      socket.on("message", (rawMessage) => {
        try {
          const msg = JSON.parse(rawMessage.toString());
          
          // Handle client registration
          if (msg.type === "register" && msg.uid) {
            const client = connectedClients.get(clientId);
            if (client) {
              client.uid = msg.uid;
            }
            return;
          }

          // Handle ping / keepalive
          if (msg.type === "ping") {
            socket.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
            return;
          }

          // Broadcast message to other connected clients
          const outbound = JSON.stringify({
            ...msg,
            fromClientId: clientId,
            timestamp: msg.timestamp || Date.now(),
          });

          connectedClients.forEach((c, cId) => {
            if (c.socket.readyState === WebSocket.OPEN) {
              // Direct message to specific target UID if specified
              if (msg.targetUid && msg.targetUid !== "all") {
                if (c.uid === msg.targetUid) {
                  c.socket.send(outbound);
                }
              } else if (cId !== clientId) {
                // Broadcast to all peers except sender
                c.socket.send(outbound);
              }
            }
          });
        } catch (err) {
          console.warn("[Vercel WS] Message parse error:", err);
        }
      });

      socket.on("close", () => {
        connectedClients.delete(clientId);
      });

      socket.on("error", () => {
        connectedClients.delete(clientId);
      });
    });
  }

  return wss;
}

export default async function handler(req: any, res: any) {
  // If invoked as standard HTTP GET (status check or info)
  if (req.method === "GET" && !req.headers.upgrade) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({
      status: "online",
      provider: "Vercel Native WebSocket Server (Fluid Compute Beta)",
      endpoint: "/api/ws",
      activeConnections: connectedClients.size,
      message: "Ready for WebSocket upgrade. Connect using ws:// or wss:// protocol.",
    });
  }

  // Handle WebSocket upgrade
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === "websocket") {
    const server = getWssInstance();
    const head = Buffer.from([]);
    server.handleUpgrade(req, req.socket, head, (ws) => {
      server.emit("connection", ws, req);
    });
    return;
  }

  return res.status(400).send("Expected WebSocket upgrade header.");
}
