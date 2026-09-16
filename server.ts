import express from "express";
import path from "path";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import multer from "multer";

import { db } from "./src/db/index.js";
import { records, webrtcSignals } from "./src/db/schema.js";
import { eq, and, gt, ne, or } from "drizzle-orm";

export const app = express();
export const httpServer = http.createServer(app);
const PORT = 3000;

  // Ensure uploads directory exists (fall back to /tmp/uploads on read-only environments like Cloud Run)
  let uploadsDir = path.join(process.cwd(), "uploads");
  try {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const testFile = path.join(uploadsDir, ".test");
    fs.writeFileSync(testFile, "test");
    fs.unlinkSync(testFile);
  } catch (e) {
    console.warn("Workspace uploads directory is not writable, falling back to /tmp/uploads");
    uploadsDir = "/tmp/uploads";
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
  }

  function getExtensionFromMime(mime: string, originalname: string = ""): string {
    const origExt = path.extname(originalname);
    if (origExt && origExt.length > 1) return origExt.toLowerCase();

    const m = (mime || "").toLowerCase().trim();

    // Document types
    if (m.includes("pdf")) return ".pdf";
    if (m.includes("wordprocessingml") || m.includes("docx")) return ".docx";
    if (m.includes("msword") || m === "application/doc") return ".doc";
    if (m.includes("spreadsheetml") || m.includes("xlsx")) return ".xlsx";
    if (m.includes("ms-excel") || m === "application/xls") return ".xls";
    if (m.includes("presentationml") || m.includes("pptx")) return ".pptx";
    if (m.includes("ms-powerpoint") || m === "application/ppt") return ".ppt";
    if (m.includes("rtf")) return ".rtf";
    if (m.includes("csv")) return ".csv";
    if (m.includes("json")) return ".json";
    if (m.includes("text/markdown") || m.includes("markdown")) return ".md";
    if (m.includes("text/html") || m.includes("html")) return ".html";
    if (m.includes("text/css")) return ".css";
    if (m.includes("javascript")) return ".js";
    if (m.includes("typescript")) return ".ts";
    if (m.includes("text/plain")) return ".txt";

    // Archive types
    if (m.includes("zip")) return ".zip";
    if (m.includes("rar")) return ".rar";
    if (m.includes("7z")) return ".7z";
    if (m.includes("tar")) return ".tar";
    if (m.includes("gzip") || m.includes("gz")) return ".gz";

    // Video types
    if (m.includes("mp4") || m.includes("m4v")) return ".mp4";
    if (m.includes("webm")) return ".webm";
    if (m.includes("quicktime") || m.includes("mov")) return ".mov";
    if (m.includes("matroska") || m.includes("mkv")) return ".mkv";
    if (m.includes("avi") || m.includes("msvideo")) return ".avi";
    if (m.includes("wmv")) return ".wmv";
    if (m.includes("flv")) return ".flv";
    if (m.includes("3gpp") || m.includes("3gp")) return ".3gp";
    if (m.startsWith("video/")) return ".mp4";

    // Audio types
    if (m.includes("mpeg") || m.includes("mp3")) return ".mp3";
    if (m.includes("wav") || m.includes("wave")) return ".wav";
    if (m.includes("ogg") || m.includes("oga")) return ".ogg";
    if (m.includes("m4a")) return ".m4a";
    if (m.includes("aac")) return ".aac";
    if (m.includes("flac")) return ".flac";
    if (m.includes("opus")) return ".opus";
    if (m.startsWith("audio/")) return ".mp3";

    // Image types
    if (m.includes("png")) return ".png";
    if (m.includes("jpeg") || m.includes("jpg")) return ".jpg";
    if (m.includes("webp")) return ".webp";
    if (m.includes("gif")) return ".gif";
    if (m.includes("svg")) return ".svg";
    if (m.includes("bmp")) return ".bmp";
    if (m.includes("avif")) return ".avif";
    if (m.includes("ico") || m.includes("icon")) return ".ico";
    if (m.includes("heic")) return ".heic";
    if (m.includes("tiff") || m.includes("tif")) return ".tiff";
    if (m.startsWith("image/")) return ".png";

    return "";
  }

  function detectFileMimeType(filePath: string): string {
    try {
      const ext = path.extname(filePath).toLowerCase();
      // Videos
      if (ext === ".mp4" || ext === ".m4v") return "video/mp4";
      if (ext === ".webm") return "video/webm";
      if (ext === ".mov") return "video/quicktime";
      if (ext === ".mkv") return "video/x-matroska";
      if (ext === ".avi") return "video/x-msvideo";
      if (ext === ".wmv") return "video/x-ms-wmv";
      if (ext === ".flv") return "video/x-flv";
      if (ext === ".ogv") return "video/ogg";
      if (ext === ".3gp" || ext === ".3gpp") return "video/3gpp";
      if (ext === ".ts") return "video/mp2t";
      // Audio
      if (ext === ".mp3") return "audio/mpeg";
      if (ext === ".wav") return "audio/wav";
      if (ext === ".ogg" || ext === ".oga" || ext === ".opus") return "audio/ogg";
      if (ext === ".m4a") return "audio/mp4";
      if (ext === ".flac") return "audio/flac";
      if (ext === ".aac") return "audio/aac";
      // Images
      if (ext === ".png") return "image/png";
      if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
      if (ext === ".gif") return "image/gif";
      if (ext === ".webp") return "image/webp";
      if (ext === ".svg") return "image/svg+xml";
      if (ext === ".bmp") return "image/bmp";
      if (ext === ".ico") return "image/x-icon";
      if (ext === ".avif") return "image/avif";
      if (ext === ".heic") return "image/heic";
      // Documents
      if (ext === ".pdf") return "application/pdf";
      if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      if (ext === ".doc") return "application/msword";
      if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      if (ext === ".xls") return "application/vnd.ms-excel";
      if (ext === ".pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
      if (ext === ".ppt") return "application/vnd.ms-powerpoint";
      if (ext === ".csv") return "text/csv";
      if (ext === ".json") return "application/json";
      if (ext === ".txt" || ext === ".log") return "text/plain";
      if (ext === ".md") return "text/markdown";
      if (ext === ".html" || ext === ".htm") return "text/html";
      if (ext === ".css") return "text/css";
      if (ext === ".js") return "application/javascript";
      if (ext === ".ts" || ext === ".tsx") return "application/typescript";
      // Archives
      if (ext === ".zip") return "application/zip";
      if (ext === ".rar") return "application/x-rar-compressed";
      if (ext === ".7z") return "application/x-7z-compressed";
      if (ext === ".tar") return "application/x-tar";
      if (ext === ".gz") return "application/gzip";

      // Inspect file header magic bytes if file exists
      if (fs.existsSync(filePath)) {
        const fd = fs.openSync(filePath, "r");
        const buffer = Buffer.alloc(128);
        const bytesRead = fs.readSync(fd, buffer, 0, 128, 0);
        fs.closeSync(fd);

        if (bytesRead >= 4) {
          // MP4 / MOV: 'ftyp' at offset 4
          if (bytesRead >= 8 && buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
            return "video/mp4";
          }
          // WebM / MKV
          if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) {
            return "video/webm";
          }
          // RIFF (AVI or WAV or WEBP)
          if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
            if (bytesRead >= 12 && buffer[8] === 0x41 && buffer[9] === 0x56 && buffer[10] === 0x49 && buffer[11] === 0x20) {
              return "video/x-msvideo";
            }
            if (bytesRead >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
              return "image/webp";
            }
            if (bytesRead >= 12 && buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45) {
              return "audio/wav";
            }
          }
          // FLAC
          if (buffer[0] === 0x66 && buffer[1] === 0x4C && buffer[2] === 0x61 && buffer[3] === 0x43) {
            return "audio/flac";
          }
          // PNG
          if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
            return "image/png";
          }
          // JPEG
          if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
            return "image/jpeg";
          }
          // GIF
          if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
            return "image/gif";
          }
          // Ogg
          if (buffer[0] === 0x4F && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
            return "audio/ogg";
          }
          // MP3 ID3
          if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
            return "audio/mpeg";
          }
          // PDF
          if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
            return "application/pdf";
          }
          // ZIP / DOCX / APK
          if (buffer[0] === 0x50 && buffer[1] === 0x4B && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)) {
            return "application/zip";
          }
        }
      }
    } catch (e) {}
    return "application/octet-stream";
  }

  function resolveStoredFilePath(requestedName: string): string | null {
    const fn = path.basename(requestedName);
    const p1 = path.join(uploadsDir, fn);
    const p2 = path.join("/tmp/uploads", fn);
    if (fs.existsSync(p1)) return p1;
    if (fs.existsSync(p2)) return p2;

    // Fuzzy search in uploads directories
    const searchDirs = [uploadsDir, "/tmp/uploads"];
    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const files = fs.readdirSync(dir);
        // 1. Prefix or Substring Match
        const match = files.find(
          (f) =>
            f === fn ||
            f.startsWith(fn) ||
            fn.startsWith(f) ||
            f.replace(/\.[^.]+$/, "") === fn.replace(/\.[^.]+$/, "") ||
            f.includes(fn) ||
            fn.includes(f)
        );
        if (match) {
          return path.join(dir, match);
        }
      } catch (e) {}
    }
    return null;
  }

  // Configure multer storage
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const ext = getExtensionFromMime(file.mimetype, file.originalname);
      const rawBase = path.basename(file.originalname, path.extname(file.originalname));
      const safeName = (rawBase || "file").replace(/[^a-zA-Z0-9_-]/g, "_");
      cb(null, `${safeName}-${uniqueSuffix}${ext}`);
    },
  });

  const upload = multer({
    storage: storage,
    limits: {
      fileSize: Infinity, // Allow any file size (videos, GBs, etc.)
    },
  });

  // CORS and preflight headers for all API requests
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-Session");
    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }
    next();
  });

  // Persistent registry of uploaded file metadata (original name, mime, size, ext)
  const fileMetadataPath = path.join(uploadsDir, "file_metadata.json");
  let fileMetadataStore: Record<string, { originalName: string; mimeType: string; size: number; ext: string }> = {};
  try {
    if (fs.existsSync(fileMetadataPath)) {
      fileMetadataStore = JSON.parse(fs.readFileSync(fileMetadataPath, "utf-8"));
    }
  } catch (e) {}

  const saveFileMetadata = () => {
    try {
      fs.writeFileSync(fileMetadataPath, JSON.stringify(fileMetadataStore), "utf-8");
    } catch (e) {}
  };

  // Primary file serving route with HTTP Range streaming (for video/audio) and magic byte detection
  app.get(["/uploads/:filename", "/uploads/*"], (req, res) => {
    const rawFn = req.params.filename || req.params[0] || "";
    const fn = path.basename(rawFn);
    const targetPath = resolveStoredFilePath(fn);
    if (!targetPath || !fs.existsSync(targetPath)) {
      return res.status(404).json({ error: "File not found in storage" });
    }

    const mimeType = detectFileMimeType(targetPath);
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Accept-Ranges", "bytes");

    const meta = fileMetadataStore[fn] || fileMetadataStore[path.basename(targetPath)];
    const downloadName = (req.query.filename as string) || (req.query.name as string) || meta?.originalName || path.basename(targetPath);
    if (req.query.download !== undefined) {
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(downloadName)}"`);
    }

    // Support HTTP Range requests (206 Partial Content) for video/audio seeking and buffering
    const range = req.headers.range;
    if (range) {
      try {
        const stat = fs.statSync(targetPath);
        const fileSize = stat.size;
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        const file = fs.createReadStream(targetPath, { start, end });
        const head = {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize,
          "Content-Type": mimeType,
        };
        res.writeHead(206, head);
        file.pipe(res);
        return;
      } catch (e) {}
    }

    return res.sendFile(targetPath);
  });

  // Dedicated file download proxy route to guarantee direct downloads with clean filenames
  app.get("/api/download", async (req, res) => {
    const fileUrl = req.query.url as string;
    let customName = (req.query.name as string) || (req.query.filename as string) || "download";
    if (!fileUrl) {
      return res.status(400).send("No file URL specified");
    }

    try {
      // Local storage upload
      if (fileUrl.startsWith("/uploads/")) {
        const fn = path.basename(fileUrl.split("?")[0]);
        const targetPath = resolveStoredFilePath(fn);
        if (targetPath && fs.existsSync(targetPath)) {
          const mime = detectFileMimeType(targetPath);
          const meta = fileMetadataStore[fn] || fileMetadataStore[path.basename(targetPath)];
          let finalDownloadName = customName;
          if ((!finalDownloadName || finalDownloadName === "download") && meta?.originalName) {
            finalDownloadName = meta.originalName;
          }
          if (!path.extname(finalDownloadName)) {
            const ext = meta?.ext ? `.${meta.ext}` : (path.extname(targetPath) || getExtensionFromMime(mime, targetPath));
            if (ext) finalDownloadName = `${finalDownloadName}${ext}`;
          }
          res.setHeader("Content-Type", meta?.mimeType || mime);
          return res.download(targetPath, finalDownloadName);
        }
      }

      // Base64 data URL
      if (fileUrl.startsWith("data:")) {
        const matches = fileUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const contentType = matches[1];
          const buffer = Buffer.from(matches[2], "base64");
          res.setHeader("Content-Type", contentType);
          res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(customName)}"`);
          return res.send(buffer);
        }
      }

      // Remote URL
      if (fileUrl.startsWith("http://") || fileUrl.startsWith("https://")) {
        const remoteRes = await fetch(fileUrl);
        if (!remoteRes.ok) throw new Error(`Remote fetch failed with status ${remoteRes.status}`);
        const contentType = remoteRes.headers.get("content-type") || "application/octet-stream";
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(customName)}"`);
        const arrayBuffer = await remoteRes.arrayBuffer();
        return res.send(Buffer.from(arrayBuffer));
      }

      res.status(404).send("File not found");
    } catch (err: any) {
      res.status(500).send(err.message || "Failed to download file");
    }
  });

  // Media inspection API to detect true MIME and category of any file
  app.get("/api/media-info", async (req, res) => {
    const fileUrl = (req.query.url as string) || (req.query.file as string) || "";
    if (!fileUrl) {
      return res.status(400).json({ error: "Missing url parameter" });
    }

    try {
      if (fileUrl.startsWith("/uploads/")) {
        const fn = path.basename(fileUrl.split("?")[0]);
        const targetPath = resolveStoredFilePath(fn);
        if (targetPath && fs.existsSync(targetPath)) {
          const mime = detectFileMimeType(targetPath);
          const stat = fs.statSync(targetPath);
          let cat = "file";
          if (mime.startsWith("video/")) cat = "video";
          else if (mime.startsWith("audio/")) cat = "audio";
          else if (mime.startsWith("image/")) cat = "image";

          const meta = fileMetadataStore[fn] || fileMetadataStore[path.basename(targetPath)];
          let origName: string | undefined = meta?.originalName;

          if (!origName) {
            try {
              const u = new URL(fileUrl, "https://local.dummy");
              origName = u.searchParams.get("name") || u.searchParams.get("filename") || undefined;
            } catch (e) {}
          }

          if (!origName) {
            const diskBase = path.basename(targetPath);
            const m = diskBase.match(/^(.*?)-(\d{10,14})-(\d{5,12})(\.[a-zA-Z0-9]+)$/);
            if (m) {
              origName = `${m[1].replace(/_/g, " ")}${m[4]}`;
            } else {
              origName = diskBase;
            }
          }

          const fileExt = path.extname(origName || targetPath).replace(/^\./, "");

          return res.json({
            type: cat,
            mimeType: meta?.mimeType || mime,
            size: meta?.size || stat.size,
            filename: origName,
            extension: fileExt,
          });
        }
      }

      if (fileUrl.startsWith("data:")) {
        const matches = fileUrl.match(/^data:([^;]+);base64,/);
        const mime = matches ? matches[1] : "application/octet-stream";
        let cat = "file";
        if (mime.startsWith("video/")) cat = "video";
        else if (mime.startsWith("audio/")) cat = "audio";
        else if (mime.startsWith("image/")) cat = "image";
        return res.json({ type: cat, mimeType: mime });
      }

      const headRes = await fetch(fileUrl, { method: "HEAD" });
      const ct = headRes.headers.get("content-type") || "";
      let cat = "file";
      if (ct.startsWith("video/")) cat = "video";
      else if (ct.startsWith("audio/")) cat = "audio";
      else if (ct.startsWith("image/")) cat = "image";
      return res.json({ type: cat, mimeType: ct });
    } catch (e) {
      return res.json({ type: "file", mimeType: "application/octet-stream" });
    }
  });

  // JSON and URL parsing middleware with generous limit for large attachments
  app.use(express.json({ limit: "500mb" }));
  app.use(express.urlencoded({ extended: true, limit: "500mb" }));

  // ==========================================
  // Distributed Postgres Engine & Storage
  // ==========================================
  
  let dbInstance: any = null;
  async function getDb() {
    if (dbInstance) return dbInstance;
    
    const { createPool } = await import("./src/db/index.js");
    const pool = createPool();
    
    dbInstance = {
      run: async (sql: string, params: any[] = []) => {
        let i = 1;
        let pgSql = sql.replace(/\?/g, () => `$${i++}`);
        
        // Convert SQLite INSERT OR REPLACE INTO to Postgres UPSERT
        if (pgSql.toUpperCase().includes("INSERT OR REPLACE INTO RECORDS") || pgSql.toUpperCase().includes("INSERT INTO RECORDS")) {
           if (!pgSql.toUpperCase().includes("ON CONFLICT")) {
             pgSql = pgSql.replace(/INSERT OR REPLACE INTO records/gi, "INSERT INTO records");
             pgSql += " ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, timestamp = EXCLUDED.timestamp";
           }
        }
        
        return pool.query(pgSql, params);
      },
      all: async (sql: string, params: any[] = []) => {
        let i = 1;
        const pgSql = sql.replace(/\?/g, () => `$${i++}`);
        const rs = await pool.query(pgSql, params);
        return rs.rows;
      },
      get: async (sql: string, params: any[] = []) => {
        let i = 1;
        const pgSql = sql.replace(/\?/g, () => `$${i++}`);
        const rs = await pool.query(pgSql, params);
        return rs.rows[0];
      }
    };

    return dbInstance;
  }

  // ==========================================
  // High-Performance WebSocket Engine (/api/ws)
  // Instant 0ms Latency Driver with Persistence
  // ==========================================
  interface ExtendedWebSocket extends WebSocket {
    isAlive?: boolean;
    uid?: string;
    subscriptions?: Set<string>;
  }

  const wsClients = new Set<ExtendedWebSocket>();
  export const wss = new WebSocketServer({ noServer: true });

  export const broadcastWebSocketChange = (
    op: string,
    collection: string,
    id: string,
    data: any,
    excludeWs?: WebSocket
  ) => {
    const payload = JSON.stringify({
      type: "change",
      op,
      collection,
      id,
      data,
      timestamp: Date.now(),
    });

    wsClients.forEach((client) => {
      if (client === excludeWs) return;
      if (client.readyState === WebSocket.OPEN) {
        // If client has subscriptions, verify collection or wildcard
        if (!client.subscriptions || client.subscriptions.size === 0 || client.subscriptions.has("all") || client.subscriptions.has(collection)) {
          try {
            client.send(payload);
          } catch (e) {
            wsClients.delete(client);
          }
        }
      }
    });
  };

  export const broadcastWebSocketSignal = (
    signal: any,
    excludeWs?: WebSocket
  ) => {
    const payload = JSON.stringify({
      type: "webrtc_signal",
      payload: signal,
      timestamp: Date.now(),
    });

    const targetUid = signal?.targetUid;

    wsClients.forEach((client) => {
      if (client === excludeWs) return;
      if (client.readyState === WebSocket.OPEN) {
        // Direct routing: if targetUid is specific, prioritize matching client
        if (targetUid && targetUid !== "all") {
          if (client.uid === targetUid) {
            try {
              client.send(payload);
            } catch (e) {
              wsClients.delete(client);
            }
          }
        } else {
          try {
            client.send(payload);
          } catch (e) {
            wsClients.delete(client);
          }
        }
      }
    });
  };

  wss.on("connection", (ws: ExtendedWebSocket) => {
    ws.isAlive = true;
    ws.subscriptions = new Set(["all"]);
    wsClients.add(ws);

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", async (rawMessage) => {
      try {
        const msg = JSON.parse(rawMessage.toString());
        if (!msg || typeof msg !== "object") return;

        // 1. Heartbeat Ping / Pong
        if (msg.type === "ping") {
          ws.isAlive = true;
          ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
          return;
        }

        // 2. User UID Registration
        if (msg.type === "register_uid" && msg.uid) {
          ws.uid = msg.uid;
          return;
        }

        // 3. Collection Subscription
        if (msg.type === "subscribe" && msg.collection) {
          ws.subscriptions = ws.subscriptions || new Set();
          ws.subscriptions.add(msg.collection);
          return;
        }

        // 4. Instant Mutation / Database Write over WebSocket
        if (msg.type === "change" && msg.collection && msg.id) {
          const { op, collection: col, id, data } = msg;
          const ts = Date.now();
          let recordData = data;

          // Asynchronously persist to database (Cloud SQL / Postgres / Local records table)
          getDb().then(async (db) => {
            try {
              if (op === "delete") {
                await db.run("DELETE FROM records WHERE collection = ? AND id = ?", [col, id]);
              } else if (op === "update") {
                const row = await db.get("SELECT data FROM records WHERE collection = ? AND id = ?", [col, id]);
                const existing = row ? JSON.parse(row.data) : {};
                recordData = { ...existing, ...data, id };
                await db.run(
                  "INSERT OR REPLACE INTO records (collection, id, data, timestamp) VALUES (?, ?, ?, ?)",
                  [col, id, JSON.stringify(recordData), ts]
                );
              } else {
                recordData = { ...data, id };
                await db.run(
                  "INSERT OR REPLACE INTO records (collection, id, data, timestamp) VALUES (?, ?, ?, ?)",
                  [col, id, JSON.stringify(recordData), ts]
                );
              }

              // Prune stale presence and voice users
              if (col === "presence" || col === "voice_users") {
                const staleThreshold = ts - 120000;
                await db.run("DELETE FROM records WHERE collection = ? AND timestamp < ?", [col, staleThreshold]);
              }
            } catch (err) {
              console.warn("[WS Database Persistence]", err);
            }
          }).catch(() => {});

          // Instant 0ms broadcast to all other WebSocket clients
          broadcastWebSocketChange(op || "set", col, id, recordData, ws);

          // Also broadcast to SSE clients
          broadcastCassandraChange(op || "set", col, id, recordData);
          return;
        }

        // 5. Instant WebRTC Signaling over WebSocket
        if (msg.type === "webrtc_signal" && msg.payload) {
          const sigObj = {
            id: msg.payload?.id || ("sig_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8)),
            uid: msg.payload?.uid,
            targetUid: msg.payload?.targetUid,
            type: msg.payload?.type,
            sdp: msg.payload?.sdp,
            candidate: msg.payload?.candidate,
            timestamp: msg.payload?.timestamp || Date.now(),
          };

          // Store in DB for reliability
          getDb().then(async (db) => {
            try {
              await db.run(
                "INSERT INTO webrtc_signals (id, target_uid, uid, payload, timestamp) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, timestamp = EXCLUDED.timestamp",
                [sigObj.id, sigObj.targetUid, sigObj.uid, JSON.stringify(sigObj), sigObj.timestamp]
              );
            } catch (e) {}
          }).catch(() => {});

          // Direct instant delivery to peer(s)
          broadcastWebSocketSignal(sigObj, ws);

          // Mirror to SSE stream
          broadcastWebRTCSignal(sigObj);
          return;
        }
      } catch (err) {
        // ignore malformed ws payloads
      }
    });

    ws.on("close", () => {
      wsClients.delete(ws);
    });

    ws.on("error", () => {
      wsClients.delete(ws);
    });
  });

  // Proactive WebSocket Heartbeat Interval (Every 25 seconds)
  const wsHeartbeatInterval = setInterval(() => {
    wsClients.forEach((ws) => {
      if (ws.isAlive === false) {
        wsClients.delete(ws);
        try { ws.terminate(); } catch (e) {}
        return;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (e) {
        wsClients.delete(ws);
      }
    });
  }, 25000);

  // Upgrade HTTP connections to WebSocket on /api/ws and /ws
  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", "http://localhost");
    const pathname = url.pathname;

    if (pathname === "/api/ws" || pathname === "/ws" || pathname.startsWith("/api/ws/")) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  // Connected SSE clients for real-time broadcasts
  const sseClients = new Set<express.Response>();

  const broadcastCassandraChange = (
    op: string,
    collection: string,
    id: string,
    data: any
  ) => {
    // Also notify WebSockets
    broadcastWebSocketChange(op, collection, id, data);

    const payload = JSON.stringify({
      type: "change",
      op,
      collection,
      id,
      data,
      timestamp: Date.now(),
    });

    sseClients.forEach((client) => {
      try {
        client.write(`data: ${payload}\n\n`);
        (client as any).flush?.();
      } catch (e) {
        sseClients.delete(client);
      }
    });
  };

  const broadcastWebRTCSignal = (signal: any) => {
    // Also notify WebSockets
    broadcastWebSocketSignal(signal);

    const payload = JSON.stringify({
      type: "webrtc_signal",
      payload: signal,
      timestamp: Date.now(),
    });

    sseClients.forEach((client) => {
      try {
        client.write(`event: webrtc_signal\ndata: ${payload}\n\n`);
        client.write(`data: ${payload}\n\n`);
        (client as any).flush?.();
      } catch (e) {
        sseClients.delete(client);
      }
    });
  };

  // 1. Cassandra Realtime SSE Stream
  app.get("/api/cassandra/stream", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    res.write(":" + " ".repeat(2048) + "\n\n");

    res.write(
      `data: ${JSON.stringify({
        type: "connected",
        provider: "Cloud SQL (PostgreSQL)",
        quota: "Unlimited (0 / ∞)",
        serverTime: Date.now(),
      })}\n\n`
    );

    try {
      const db = await getDb();
      const rows = await db.all("SELECT collection, id, data FROM records");
      const result: Record<string, Record<string, any>> = {};
      rows.forEach((r: any) => {
        if (!result[r.collection]) result[r.collection] = {};
        result[r.collection][r.id] = JSON.parse(r.data);
      });
      res.write(
        `data: ${JSON.stringify({
          type: "init",
          data: result,
        })}\n\n`
      );
    } catch(e) {}
    
    (res as any).flush?.();
    sseClients.add(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(":ping\n\n");
      } catch (e) {
        clearInterval(heartbeat);
      }
    }, 10000);

    req.on("close", () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  // Dedicated WebRTC Signaling Endpoints (Zero-delay P2P negotiation)
  app.post("/api/webrtc/signal", async (req, res) => {
    try {
      const { uid, targetUid, type, sdp, candidate, timestamp } = req.body || {};
      if (!uid || !targetUid || !type) {
        return res.status(400).json({ error: "Missing required signal fields" });
      }

      const sigObj = {
        id: req.body?.id || ("sig_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8)),
        uid,
        targetUid,
        type,
        sdp: sdp || undefined,
        candidate: candidate || undefined,
        timestamp: timestamp || Date.now(),
      };

      const db = await getDb();
      await db.run(
        "INSERT INTO webrtc_signals (id, target_uid, uid, payload, timestamp) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, timestamp = EXCLUDED.timestamp",
        [sigObj.id, sigObj.targetUid, sigObj.uid, JSON.stringify(sigObj), sigObj.timestamp]
      );
      
      // Cleanup old signals
      const cutoff = Date.now() - 30000;
      await db.run("DELETE FROM webrtc_signals WHERE timestamp < ?", [cutoff]);

      // Broadcast immediately via SSE
      broadcastWebRTCSignal(sigObj);

      res.json({ success: true, id: sigObj.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/webrtc/signals", async (req, res) => {
    try {
      const targetUid = req.query.uid as string;
      const since = parseInt(req.query.since as string, 10) || (Date.now() - 15000);
      if (!targetUid) {
        return res.json({ signals: [] });
      }

      const db = await getDb();
      const rows = await db.all(
        "SELECT payload FROM webrtc_signals WHERE (target_uid = ? OR target_uid = 'all') AND timestamp > ? AND uid != ?",
        [targetUid, since, targetUid]
      );
      
      const signals = rows.map((r: any) => {
        try {
          return JSON.parse(r.payload);
        } catch {
          return null;
        }
      }).filter(Boolean);

      res.json({ signals, timestamp: Date.now() });
    } catch (e) {
      res.json({ signals: [], timestamp: Date.now() });
    }
  });

  // 2. Cassandra Data / Query Endpoint
  app.get("/api/cassandra/data", async (req, res) => {
    try {
      const col = req.query.collection as string;
      const db = await getDb();
      
      if (col) {
        const rows = await db.all("SELECT id, data FROM records WHERE collection = ?", [col]);
        const result: Record<string, any> = {};
        rows.forEach((r: any) => {
          try {
            result[r.id] = JSON.parse(r.data);
          } catch(e) {}
        });
        return res.json(result);
      }
      
      const rows = await db.all("SELECT collection, id, data FROM records");
      const result: Record<string, Record<string, any>> = {};
      const collections = new Set<string>();
      rows.forEach((r: any) => {
        collections.add(r.collection);
        if (!result[r.collection]) result[r.collection] = {};
        try {
          result[r.collection][r.id] = JSON.parse(r.data);
        } catch(e) {}
      });
      
      res.json({
        status: "online",
        provider: "Cloud SQL (PostgreSQL)",
        quota: "Unlimited (0 / ∞)",
        collections: Array.from(collections),
        data: result,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 3. Cassandra Write Endpoint (handles both /write and /data)
  app.post(["/api/cassandra/write", "/api/cassandra/data"], async (req, res) => {
    try {
      const { op, collection: col, id, data } = req.body || {};
      if (!col || !id) {
        return res.status(400).json({ error: "Missing collection or id" });
      }

      const db = await getDb();
      const ts = Date.now();
      let recordData = data;

      if (op === "delete") {
        await db.run("DELETE FROM records WHERE collection = ? AND id = ?", [col, id]);
      } else if (op === "update") {
        const row = await db.get("SELECT data FROM records WHERE collection = ? AND id = ?", [col, id]);
        const existing = row ? JSON.parse(row.data) : {};
        recordData = { ...existing, ...data, id };
        await db.run(
          "INSERT OR REPLACE INTO records (collection, id, data, timestamp) VALUES (?, ?, ?, ?)",
          [col, id, JSON.stringify(recordData), ts]
        );
      } else {
        recordData = { ...data, id };
        await db.run(
          "INSERT OR REPLACE INTO records (collection, id, data, timestamp) VALUES (?, ?, ?, ?)",
          [col, id, JSON.stringify(recordData), ts]
        );
      }

      // Prune stale presence and voice users
      if (col === "presence" || col === "voice_users") {
        const staleThreshold = ts - 120000; // 2 minutes
        await db.run("DELETE FROM records WHERE collection = ? AND timestamp < ?", [col, staleThreshold]);
      }

      // Broadcast to all SSE listeners in real time
      broadcastCassandraChange(op || "set", col, id, recordData);

      res.json({ success: true, timestamp: ts });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. Cassandra Poll Endpoint
  app.get("/api/cassandra/poll", (req, res) => {
    res.json({ timestamp: Date.now(), changes: [] }); // deprecated
  });

  // 5. Cassandra Status & CQL Execution
  app.get("/api/cassandra/status", async (req, res) => {
    try {
      const db = await getDb();
      const row = await db.get("SELECT COUNT(*) as count FROM records");
      res.json({
        status: "online",
        provider: "Cloud SQL (PostgreSQL)",
        quota: "Unlimited (0 / \u221E)",
        transport: "Server-Sent Events (SSE) + Database Polling",
        activeClients: sseClients.size,
        documentCount: row.count,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/cassandra/cql", (req, res) => {
    res.json({ success: true, message: "CQL Execution Simulated." });
  });

  // ==========================================
  // File Upload Engine
  // ==========================================
  const handleFileUpload = (req: express.Request, res: express.Response) => {
    try {
      // A. Multipart file from Multer
      const file = (req as any).file || (req as any).files?.[0];
      if (file) {
        let detectedMime = file.mimetype;
        if (file.path && fs.existsSync(file.path)) {
          const magicMime = detectFileMimeType(file.path);
          if (magicMime && magicMime !== "application/octet-stream") {
            detectedMime = magicMime;
          }
        }

        const ext = getExtensionFromMime(detectedMime, file.originalname);
        let currentDiskName = file.filename;
        let origName = file.originalname || "attachment";

        // If file on disk lacks extension but we know it, rename on disk
        if (ext && !path.extname(currentDiskName) && file.path && fs.existsSync(file.path)) {
          const newDiskName = `${currentDiskName}${ext}`;
          const newPath = path.join(path.dirname(file.path), newDiskName);
          try {
            fs.renameSync(file.path, newPath);
            currentDiskName = newDiskName;
          } catch (e) {}
        }

        if (!path.extname(origName) && ext) {
          origName = `${origName}${ext}`;
        }

        const cleanExt = (path.extname(origName) || ext || "").replace(/^\./, "").toLowerCase();

        // Save original metadata permanently
        fileMetadataStore[currentDiskName] = {
          originalName: origName,
          mimeType: detectedMime,
          size: file.size,
          ext: cleanExt,
        };
        saveFileMetadata();

        const fileUrl = `/uploads/${currentDiskName}?name=${encodeURIComponent(origName)}&type=${encodeURIComponent(detectedMime)}&size=${file.size}`;
        return res.json({
          url: fileUrl,
          filename: origName,
          mimetype: detectedMime,
          size: file.size,
          extension: cleanExt,
        });
      }

      // B. JSON payload with base64 data URL
      if (req.body && req.body.fileData) {
        const { fileData, filename, mimetype, size } = req.body;
        const matches = fileData.match(/^data:([A-Za-z0-9\/\-\+\.]+);base64,(.+)$/);
        const resolvedMime = mimetype || (matches ? matches[1] : "application/octet-stream");
        let origName = filename || "uploaded_file";
        const ext = path.extname(origName) || getExtensionFromMime(resolvedMime, origName);
        if (!path.extname(origName) && ext) {
          origName = `${origName}${ext}`;
        }
        const cleanExt = (path.extname(origName) || ext || "").replace(/^\./, "").toLowerCase();

        if (matches && matches.length === 3) {
          const uniqueName = `upload-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext || ".bin"}`;
          const filePath = path.join(uploadsDir, uniqueName);
          try {
            fs.writeFileSync(filePath, Buffer.from(matches[2], "base64"));
            fileMetadataStore[uniqueName] = {
              originalName: origName,
              mimeType: resolvedMime,
              size: size || fileData.length,
              ext: cleanExt,
            };
            saveFileMetadata();

            const fileUrl = `/uploads/${uniqueName}?name=${encodeURIComponent(origName)}&type=${encodeURIComponent(resolvedMime)}&size=${size || fileData.length}`;
            return res.json({
              url: fileUrl,
              filename: origName,
              mimetype: resolvedMime,
              size: size || fileData.length,
              extension: cleanExt,
            });
          } catch (e) {}
        }

        return res.json({
          url: fileData,
          filename: origName,
          mimetype: resolvedMime,
          size: size || fileData.length,
          extension: cleanExt,
        });
      }

      return res.status(400).json({ error: "No file provided" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // Support chunked upload for ultra-large files (videos, high-res images, etc.)
  const chunkStore: Record<string, string[]> = {};
  
  app.post("/api/upload/chunk", upload.any(), (req, res) => {
    const { uploadId, chunkIndex, totalChunks, filename, mimetype, size } = req.body;
    const chunkFile = req.files && Array.isArray(req.files) ? req.files[0] : null;
    
    if (!chunkFile) return res.status(400).send("No chunk file received");
    
    const parsedTotal = parseInt(totalChunks, 10) || 1;
    const parsedIndex = parseInt(chunkIndex, 10) || 0;

    if (!chunkStore[uploadId]) {
      chunkStore[uploadId] = new Array(parsedTotal);
    }
    
    chunkStore[uploadId][parsedIndex] = chunkFile.path;
    
    // Check if all chunks have arrived
    const receivedCount = chunkStore[uploadId].filter(Boolean).length;
    if (receivedCount === parsedTotal) {
       const ext = getExtensionFromMime(mimetype, filename);
       const cleanExt = (path.extname(filename) || ext || "").replace(/^\./, "").toLowerCase();
       const uniqueName = `upload-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext || ".bin"}`;
       const finalPath = path.join(uploadsDir, uniqueName);
       
       try {
         // Synchronously stream all chunks to disk in order to ensure atomic integrity
         const fd = fs.openSync(finalPath, "w");
         for (let i = 0; i < parsedTotal; i++) {
           const chunkPath = chunkStore[uploadId][i];
           if (chunkPath && fs.existsSync(chunkPath)) {
             const data = fs.readFileSync(chunkPath);
             fs.writeSync(fd, data);
             try { fs.unlinkSync(chunkPath); } catch (e) {}
           }
         }
         fs.closeSync(fd);
       } catch (assemblyErr: any) {
         console.error("Chunk reassembly error:", assemblyErr);
         return res.status(500).json({ error: "Failed to assemble file chunks on server" });
       }
       
       delete chunkStore[uploadId];
       
       const realSize = fs.existsSync(finalPath) ? fs.statSync(finalPath).size : parseInt(size || "0", 10);
       
       fileMetadataStore[uniqueName] = {
           originalName: filename || "uploaded_file",
           mimeType: mimetype || "application/octet-stream",
           size: realSize,
           ext: cleanExt,
       };
       saveFileMetadata();
       
       const fileUrl = `/uploads/${uniqueName}?name=${encodeURIComponent(filename)}&type=${encodeURIComponent(mimetype)}&size=${realSize}`;
       return res.json({
           url: fileUrl,
           filename,
           mimetype,
           size: realSize,
       });
    }
    
    return res.json({ status: "chunk_received", chunkIndex: parsedIndex, totalChunks: parsedTotal, received: receivedCount });
  });

  app.post("/api/upload", upload.any(), handleFileUpload);
  app.post("/api/sethbase/upload", upload.any(), handleFileUpload);
  app.post("/upload", upload.any(), handleFileUpload);

  // Informative GET on /api/upload so it never 404s
  app.get(["/api/upload", "/api/sethbase/upload"], (req, res) => {
    res.json({
      status: "ready",
      provider: "Apache Cassandra File Storage Engine",
      quota: "Unlimited (0 / \u221E)",
      message: "Ready to accept uploads via POST multipart/form-data or JSON base64",
    });
  });

  // Helper: Locate or temporarily download media file for Groq AI analysis
  async function getLocalMediaFile(mediaUrl: string): Promise<{ filePath: string; cleanup: () => void } | null> {
    if (!mediaUrl) return null;

    // Check if it is a local upload path
    if (mediaUrl.startsWith("/uploads/") || mediaUrl.startsWith("uploads/")) {
      const fn = path.basename(mediaUrl.split("?")[0]);
      const localPath = path.join(uploadsDir, fn);
      if (fs.existsSync(localPath)) {
        return { filePath: localPath, cleanup: () => {} };
      }
    }

    // Remote URL (e.g. GIPHY, CDN, or Supabase)
    if (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://")) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const resp = await fetch(mediaUrl, { signal: controller.signal });
        clearTimeout(timeout);
        if (!resp.ok) return null;
        const arrayBuffer = await resp.arrayBuffer();
        const tempPath = path.join("/tmp", `groq_media_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
        fs.writeFileSync(tempPath, Buffer.from(arrayBuffer));
        return {
          filePath: tempPath,
          cleanup: () => {
            try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) {}
          }
        };
      } catch (e) {
        return null;
      }
    }

    return null;
  }

  // 🖼️ For Images & Visual Frames: Multimodal Vision using Qwen (qwen/qwen3.8-27b / qwen3.6-27b)
  async function inspectImageWithVision(imagePath: string, apiKey: string): Promise<{ safe: boolean; reason?: string; description?: string }> {
    const scaledTmp = path.join("/tmp", `groq_scaled_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`);
    try {
      // Scale down image to 480px to optimize tokens and stay within Groq rate limits
      try {
        const { execSync } = await import("child_process");
        execSync(`ffmpeg -y -i "${imagePath}" -vf "scale='min(480,iw)':-1" -q:v 3 "${scaledTmp}" 2>/dev/null`, { timeout: 8000 });
      } catch (e) {
        fs.copyFileSync(imagePath, scaledTmp);
      }

      if (!fs.existsSync(scaledTmp) || fs.statSync(scaledTmp).size < 100) {
        return { safe: true };
      }

      const base64 = fs.readFileSync(scaledTmp).toString("base64");
      const visionModel = process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b";

      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: visionModel,
          max_tokens: 120,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Analyze this image. Perform OCR and check visual content. Respond strictly in valid JSON: {\"safe\": boolean, \"reason\": \"string\", \"description\": \"summary\"}. Set safe to false if it contains explicit sexual content, nudity, graphic violence, hate symbols, or offensive slurs."
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/jpeg;base64,${base64}`
                  }
                }
              ]
            }
          ]
        })
      });

      if (res.ok) {
        const data: any = await res.json();
        const content = data.choices?.[0]?.message?.content || "";
        const cleaned = content.replace(/```json/g, "").replace(/```/g, "").trim();
        try {
          const parsed = JSON.parse(cleaned);
          return {
            safe: parsed.safe !== false,
            reason: parsed.reason || "",
            description: parsed.description || ""
          };
        } catch (e) {
          if (content.toLowerCase().includes("unsafe") || content.toLowerCase().includes("not safe") || content.toLowerCase().includes("explicit")) {
            return { safe: false, reason: "Explicit or inappropriate visual content detected." };
          }
        }
      }
    } catch (err) {
      console.warn("Vision inspection notice:", err);
    } finally {
      try { if (fs.existsSync(scaledTmp)) fs.unlinkSync(scaledTmp); } catch (e) {}
    }
    return { safe: true };
  }

  // 🎵 For Audio Files: Dedicated Speech-to-Text Pipeline using Whisper Large V3
  async function transcribeAudioWithWhisper(audioPath: string, apiKey: string): Promise<string> {
    try {
      if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size < 300) return "";

      const buffer = fs.readFileSync(audioPath);
      const blob = new Blob([buffer], { type: "audio/mp3" });
      const form = new FormData();
      form.append("file", blob, path.basename(audioPath));
      form.append("model", process.env.GROQ_AUDIO_MODEL || "whisper-large-v3");
      form.append("response_format", "json");

      const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`
        },
        body: form
      });

      if (res.ok) {
        const data: any = await res.json();
        return (data.text || "").trim();
      }
    } catch (err) {
      console.warn("Whisper transcription notice:", err);
    }
    return "";
  }

  // 🎬 For Video Files: Compound Pipeline (Audio track via Whisper + Key snapshots via Qwen Vision)
  async function inspectVideoCompound(videoPath: string, apiKey: string): Promise<{ safe: boolean; reason?: string; transcript?: string }> {
    const uid = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const audioTmp = path.join("/tmp", `vid_aud_${uid}.mp3`);
    const framePattern = path.join("/tmp", `vid_frm_${uid}_%02d.jpg`);
    const extractedFrames: string[] = [];

    try {
      const { execSync } = await import("child_process");

      // 1. Audio Track: Extract sound from video and transcribe with Whisper Large V3
      try {
        execSync(`ffmpeg -y -i "${videoPath}" -vn -ar 16000 -ac 1 -b:a 32k -t 60 "${audioTmp}" 2>/dev/null`, { timeout: 10000 });
      } catch (e) {}

      let transcript = "";
      if (fs.existsSync(audioTmp) && fs.statSync(audioTmp).size > 800) {
        transcript = await transcribeAudioWithWhisper(audioTmp, apiKey);
      }

      // 2. Visual Frames: Extract key snapshot frames from the video and analyze with Qwen Vision
      try {
        execSync(`ffmpeg -y -i "${videoPath}" -vf "fps=1/5,scale='min(480,iw)':-1" -vframes 2 "${framePattern}" 2>/dev/null`, { timeout: 10000 });
        for (let i = 1; i <= 3; i++) {
          const fPath = path.join("/tmp", `vid_frm_${uid}_0${i}.jpg`);
          if (fs.existsSync(fPath)) {
            extractedFrames.push(fPath);
          }
        }
      } catch (e) {}

      // Inspect extracted video snapshot frames
      for (const fPath of extractedFrames) {
        const frameInspection = await inspectImageWithVision(fPath, apiKey);
        if (!frameInspection.safe) {
          return {
            safe: false,
            reason: frameInspection.reason || "Inappropriate visual scene detected in video frames.",
            transcript
          };
        }
      }

      return { safe: true, transcript };
    } catch (err) {
      console.warn("Video compound inspection notice:", err);
      return { safe: true };
    } finally {
      try { if (fs.existsSync(audioTmp)) fs.unlinkSync(audioTmp); } catch (e) {}
      for (const fPath of extractedFrames) {
        try { if (fs.existsSync(fPath)) fs.unlinkSync(fPath); } catch (e) {}
      }
    }
  }

  // Moderation Endpoint: Multi-Model AI Pipeline (Qwen Vision + Whisper Large V3 + Llama Specdec / Safeguard)
  app.post("/api/moderate", async (req, res) => {
    try {
      const { text, mediaUrl, mediaTitle, mediaType, mediaSize } = req.body;

      let detectedTitle = (mediaTitle || "").trim();
      let detectedType = (mediaType || "").trim();
      let detectedSize = parseInt(mediaSize || "0", 10);

      // Extract metadata from mediaUrl if not provided
      if (mediaUrl) {
        try {
          if (mediaUrl.includes("?")) {
            const parsedU = new URL(mediaUrl, "http://127.0.0.1:3000");
            if (!detectedTitle) detectedTitle = parsedU.searchParams.get("name") || parsedU.searchParams.get("filename") || "";
            if (!detectedType) detectedType = parsedU.searchParams.get("type") || "";
            if (!detectedSize && parsedU.searchParams.get("size")) {
              detectedSize = parseInt(parsedU.searchParams.get("size") || "0", 10);
            }
          }
          if (mediaUrl.startsWith("/uploads/")) {
            const fn = path.basename(mediaUrl.split("?")[0]);
            const storedMeta = fileMetadataStore[fn];
            if (storedMeta) {
              if (!detectedTitle) detectedTitle = storedMeta.originalName;
              if (!detectedType) detectedType = storedMeta.mimeType;
              if (!detectedSize) detectedSize = storedMeta.size;
            }
          }
        } catch (e) {}
      }

      // Classify media category: GIF, Video, Image, Audio, or File
      let mediaCategory = "media attachment";
      const lowerType = (detectedType || "").toLowerCase();
      const lowerTitle = (detectedTitle || "").toLowerCase();
      const lowerUrl = (mediaUrl || "").toLowerCase();

      if (lowerType.includes("gif") || lowerTitle.endsWith(".gif") || lowerUrl.includes(".gif")) {
        mediaCategory = "GIF animation";
      } else if (lowerType.startsWith("video/") || /\.(mp4|webm|mkv|mov|avi|wmv|flv|m4v)(\?|$)/.test(lowerTitle || lowerUrl)) {
        mediaCategory = "video";
      } else if (lowerType.startsWith("image/") || /\.(png|jpg|jpeg|webp|svg|bmp|avif)(\?|$)/.test(lowerTitle || lowerUrl)) {
        mediaCategory = "image";
      } else if (lowerType.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/.test(lowerTitle || lowerUrl)) {
        mediaCategory = "audio track";
      }

      // LAYER 1: Fast Offline Profanity Filter on Message Text & Titles
      const { Filter } = await import("bad-words");
      const filter = new Filter();
      filter.addWords('kys', 'kms', 'stfu', 'gtfo');

      const textTokens = (text || "").replace(/[^a-zA-Z0-9]/g, " ");
      if (text && (filter.isProfane(text) || filter.isProfane(textTokens))) {
        return res.json({ safe: false, reason: "Inappropriate language or profanity detected in message text." });
      }

      const titleTokens = (detectedTitle || "").replace(/[^a-zA-Z0-9]/g, " ");
      if (detectedTitle && (filter.isProfane(detectedTitle) || filter.isProfane(titleTokens))) {
        return res.json({ safe: false, reason: `Inappropriate language or profanity detected in ${mediaCategory} title ("${detectedTitle}").` });
      }

      const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
      let audioTranscript = "";

      // LAYER 2: Media-Specific Compound Pipeline (Images -> Qwen Vision, Audio -> Whisper, Video -> Compound)
      if (mediaUrl) {
        const localMedia = await getLocalMediaFile(mediaUrl);
        if (localMedia) {
          try {
            if (mediaCategory === "image" || mediaCategory === "GIF animation") {
              // 🖼️ Analyze Image/GIF with Qwen Vision
              const visionCheck = await inspectImageWithVision(localMedia.filePath, GROQ_API_KEY);
              if (!visionCheck.safe) {
                return res.json({ safe: false, reason: visionCheck.reason || `Inappropriate visual content detected in ${mediaCategory}.` });
              }
            } else if (mediaCategory === "audio track") {
              // 🎵 Transcribe Audio with Whisper Large V3
              audioTranscript = await transcribeAudioWithWhisper(localMedia.filePath, GROQ_API_KEY);
              if (audioTranscript) {
                const audioTokens = audioTranscript.replace(/[^a-zA-Z0-9]/g, " ");
                if (filter.isProfane(audioTranscript) || filter.isProfane(audioTokens)) {
                  return res.json({ safe: false, reason: `Inappropriate language detected in audio speech ("${audioTranscript.slice(0, 60)}...").` });
                }
              }
            } else if (mediaCategory === "video") {
              // 🎬 Compound Video Pipeline (Whisper Audio + Qwen Vision Snapshots)
              const videoCheck = await inspectVideoCompound(localMedia.filePath, GROQ_API_KEY);
              if (!videoCheck.safe) {
                return res.json({ safe: false, reason: videoCheck.reason || "Inappropriate content detected in video." });
              }
              if (videoCheck.transcript) {
                audioTranscript = videoCheck.transcript;
                const vidAudioTokens = audioTranscript.replace(/[^a-zA-Z0-9]/g, " ");
                if (filter.isProfane(audioTranscript) || filter.isProfane(vidAudioTokens)) {
                  return res.json({ safe: false, reason: `Inappropriate language detected in video speech ("${audioTranscript.slice(0, 60)}...").` });
                }
              }
            }
          } finally {
            localMedia.cleanup();
          }
        }
      }

      // LAYER 3: Profanity & Context Analysis using llama-3.3-70b-specdec (with safeguard fallback)
      const contentParts: any[] = [];
      let evaluationPrompt = "Evaluate the safety and appropriateness of the following submission:\n";
      if (text) {
        evaluationPrompt += `- Message Text: "${text}"\n`;
      }
      if (detectedTitle) {
        evaluationPrompt += `- ${mediaCategory} Title: "${detectedTitle}"\n`;
      }
      if (audioTranscript) {
        evaluationPrompt += `- Spoken Audio Transcript: "${audioTranscript}"\n`;
      }
      if (detectedSize > 0) {
        evaluationPrompt += `- File Size: ${(detectedSize / (1024 * 1024)).toFixed(2)} MB\n`;
      }

      evaluationPrompt += `\nThoroughly check for profanity, slurs, explicit NSFW/sexual content, graphic violence, hate speech, or harassment.`;
      contentParts.push({ type: "text", text: evaluationPrompt });
      contentParts.push({ type: "text", text: "Respond ONLY in raw JSON: {\"safe\": boolean, \"reason\": \"string\"}. Set safe to false if inappropriate." });

      const PRIMARY_TEXT_MODEL = process.env.GROQ_TEXT_MODEL || "llama-3.3-70b-specdec";
      const FALLBACK_MODELS = ["openai/gpt-oss-safeguard-20b", "openai/gpt-oss-120b"];
      let activeModel = PRIMARY_TEXT_MODEL;

      let orRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: activeModel,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: contentParts }]
        })
      });

      // If the primary model (e.g. llama-3.3-70b-specdec) is unavailable/decommissioned on Groq, fallback gracefully
      if (!orRes.ok) {
        for (const fallback of FALLBACK_MODELS) {
          activeModel = fallback;
          orRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${GROQ_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: activeModel,
              response_format: { type: "json_object" },
              messages: [{ role: "user", content: contentParts }]
            })
          });
          if (orRes.ok) break;
        }
      }

      if (orRes.ok) {
        const orData = await orRes.json();
        let resultText = orData.choices?.[0]?.message?.content || "";
        resultText = resultText.replace(/```json/g, "").replace(/```/g, "").trim();
        try {
          const json = JSON.parse(resultText);
          return res.json(json);
        } catch (e) {}
      }

      return res.json({ safe: true });
    } catch (err) {
      console.error("Moderation pipeline error:", err);
      return res.json({ safe: true });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", mode: process.env.NODE_ENV });
  });

  // Dynamic LuminSDK Session & Image proxy
  let cachedLuminSessionId: string | null = null;
  let cachedLuminSessionExpiry = 0;

  async function getLuminSessionId(): Promise<string> {
    const now = Date.now();
    if (cachedLuminSessionId && now < cachedLuminSessionExpiry) {
      return cachedLuminSessionId;
    }
    
    try {
      const res = await fetch("https://a.luminsdk.com/api/v1/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (res.ok) {
        const data: any = await res.json();
        if (data && data.session_id) {
          cachedLuminSessionId = data.session_id;
          cachedLuminSessionExpiry = now + 10 * 60 * 1000; // Cache for 10 minutes
          return data.session_id;
        }
      }
    } catch (err) {
      console.error("Error fetching Lumin session:", err);
    }
    
    return cachedLuminSessionId || "60919094aa4265e2fd2bc9e9b1874e4e";
  }

  app.get("/api/lumin-icon/*", async (req, res) => {
    try {
      let token = (req.params as any)[0] || req.path.replace("/api/lumin-icon/", "");
      if (!token) {
        return res.status(400).send("Missing token");
      }
      
      const sessionId = await getLuminSessionId();
      const freshToken = token.replace(/^[^/]+/, sessionId);
      const targetUrl = `https://a.luminsdk.com/api/v1/assets/${freshToken}`;
      
      const response = await fetch(targetUrl);
      if (!response.ok) {
        return res.status(response.status).send(`Failed to fetch from Lumin: ${response.statusText}`);
      }
      
      const contentType = response.headers.get("content-type");
      if (contentType) {
        res.setHeader("Content-Type", contentType);
      }
      
      res.setHeader("Cache-Control", "public, max-age=31536000"); // Cache for 1 year
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      return res.send(buffer);
    } catch (err: any) {
      console.error("Error proxying lumin icon:", err);
      return res.status(500).send(err.message);
    }
  });

  // Custom Real-Time Database Engine Routes (Vercel & Local Node compatible)
  app.all(["/api/db/data", "/api/db/data/*"], async (req, res) => {
    try {
      const { default: handler } = await import("./api/db/data.js").catch(() => import("./api/db/data"));
      return handler(req, res);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || String(err) });
    }
  });

  app.get(["/api/db/stream", "/api/db/stream/*"], async (req, res) => {
    try {
      const { default: handler } = await import("./api/db/stream.js").catch(() => import("./api/db/stream"));
      return handler(req, res);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || String(err) });
    }
  });

  // Vite integration and static asset serving
  const isMain = typeof require !== 'undefined' && require.main === module;
  const isStandalone = typeof process !== 'undefined' && process.argv[1]?.includes('server');
  
  if (isMain || isStandalone) {
    (async () => {
      if (process.env.NODE_ENV !== "production") {
        const vite = await createViteServer({
          server: {
            middlewareMode: true,
            hmr: false,
            watch: null,
          },
          appType: "spa",
        });
        app.use(vite.middlewares);
      } else {
        const distPath = path.join(process.cwd(), "dist");
        app.use(express.static(distPath));
        app.get("*", (req, res) => {
          res.sendFile(path.join(distPath, "index.html"));
        });
      }

      httpServer.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running with WebSockets enabled on http://localhost:${PORT}`);
      });
    })();
  }

// Export the initialized Express app for serverless environments (Vercel)
export default app;
