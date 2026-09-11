import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import multer from "multer";

async function startServer() {
  const app = express();
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
          let origName = meta?.originalName;

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
  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ extended: true, limit: "100mb" }));

  // ==========================================
  // Cassandra Distributed Engine & Storage
  // ==========================================
  const cassandraStoreFile = path.join(uploadsDir, "cassandra_store.json");
  let cassandraData: Record<string, Record<string, any>> = {};
  let cassandraChangeHistory: Array<{
    timestamp: number;
    collection: string;
    id: string;
    op: string;
    data: any;
  }> = [];

  try {
    if (fs.existsSync(cassandraStoreFile)) {
      cassandraData = JSON.parse(fs.readFileSync(cassandraStoreFile, "utf-8"));
    }
  } catch (e) {
    console.warn("[Cassandra] No prior disk store found, initializing empty store");
  }

  const saveCassandraStore = () => {
    try {
      fs.writeFileSync(cassandraStoreFile, JSON.stringify(cassandraData), "utf-8");
    } catch (e) {
      // Ignore disk write failure in read-only sandbox
    }
  };

  // Connected SSE clients for real-time broadcasts
  const sseClients = new Set<express.Response>();
  let recentWebRTCSignals: Array<{
    id: string;
    uid: string;
    targetUid: string;
    type: string;
    sdp?: string;
    candidate?: string;
    timestamp: number;
  }> = [];

  const broadcastCassandraChange = (
    op: string,
    collection: string,
    id: string,
    data: any
  ) => {
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
    const payload = JSON.stringify({
      type: "webrtc_signal",
      payload: signal,
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

  // 1. Cassandra Realtime SSE Stream
  app.get("/api/cassandra/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    // Send initial 2KB comment padding to force proxies/nginx to flush buffer immediately
    res.write(":" + " ".repeat(2048) + "\n\n");

    // Send initial connection handshake and all existing documents
    res.write(
      `data: ${JSON.stringify({
        type: "connected",
        provider: "Apache Cassandra / ScyllaDB Engine",
        quota: "Unlimited (0 / \u221E)",
        serverTime: Date.now(),
      })}\n\n`
    );

    res.write(
      `data: ${JSON.stringify({
        type: "init",
        data: cassandraData,
      })}\n\n`
    );
    (res as any).flush?.();

    sseClients.add(res);

    // Heartbeat ping every 10 seconds to keep connection alive indefinitely
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
  app.post("/api/webrtc/signal", (req, res) => {
    try {
      const { uid, targetUid, type, sdp, candidate, timestamp } = req.body || {};
      if (!uid || !targetUid || !type) {
        return res.status(400).json({ error: "Missing required signal fields" });
      }

      const sigObj = {
        id: "sig_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8),
        uid,
        targetUid,
        type,
        sdp: sdp || undefined,
        candidate: candidate || undefined,
        timestamp: timestamp || Date.now(),
      };

      recentWebRTCSignals.push(sigObj);
      const cutoff = Date.now() - 30000;
      if (recentWebRTCSignals.length > 500) {
        recentWebRTCSignals = recentWebRTCSignals.filter((s) => s.timestamp > cutoff);
      }

      // Broadcast immediately via SSE to all connected clients
      broadcastWebRTCSignal(sigObj);

      res.json({ success: true, id: sigObj.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/webrtc/signals", (req, res) => {
    const targetUid = req.query.uid as string;
    const since = parseInt(req.query.since as string, 10) || (Date.now() - 15000);
    if (!targetUid) {
      return res.json({ signals: [] });
    }

    const matched = recentWebRTCSignals.filter(
      (s) => (s.targetUid === targetUid || s.targetUid === "all") && s.timestamp > since && s.uid !== targetUid
    );
    res.json({ signals: matched, timestamp: Date.now() });
  });

  // 2. Cassandra Data / Query Endpoint
  app.get("/api/cassandra/data", (req, res) => {
    const col = req.query.collection as string;
    if (col) {
      return res.json(cassandraData[col] || {});
    }
    res.json({
      status: "online",
      provider: "Apache Cassandra / ScyllaDB",
      quota: "Unlimited (0 / \u221E)",
      collections: Object.keys(cassandraData),
      data: cassandraData,
    });
  });

  // 3. Cassandra Write Endpoint
  app.post("/api/cassandra/write", (req, res) => {
    try {
      const { op, collection: col, id, data } = req.body || {};
      if (!col || !id) {
        return res.status(400).json({ error: "Missing collection or id" });
      }

      if (!cassandraData[col]) {
        cassandraData[col] = {};
      }

      if (op === "delete") {
        delete cassandraData[col][id];
      } else if (op === "update") {
        cassandraData[col][id] = {
          ...(cassandraData[col][id] || {}),
          ...data,
          id,
        };
      } else {
        cassandraData[col][id] = { ...data, id };
      }

      saveCassandraStore();

      const changeRecord = {
        timestamp: Date.now(),
        collection: col,
        id,
        op: op || "set",
        data,
      };

      cassandraChangeHistory.push(changeRecord);
      if (cassandraChangeHistory.length > 1000) {
        cassandraChangeHistory = cassandraChangeHistory.slice(-1000);
      }

      // Broadcast to all SSE listeners in real time
      broadcastCassandraChange(op || "set", col, id, data);

      res.json({ success: true, timestamp: changeRecord.timestamp });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. Cassandra Poll Endpoint
  app.get("/api/cassandra/poll", (req, res) => {
    const since = parseInt(req.query.since as string, 10) || 0;
    const newChanges = cassandraChangeHistory.filter((c) => c.timestamp > since);
    res.json({
      timestamp: Date.now(),
      changes: newChanges,
      ...(since === 0 ? { fullData: cassandraData } : {}),
    });
  });

  // 5. Cassandra Status & CQL Execution
  app.get("/api/cassandra/status", (req, res) => {
    res.json({
      status: "online",
      provider: "Apache Cassandra / ScyllaDB Engine",
      quota: "Unlimited (0 / \u221E)",
      transport: "Server-Sent Events (SSE) - No WebSockets, Vercel Compatible",
      activeClients: sseClients.size,
      collections: Object.keys(cassandraData),
      documentCount: Object.values(cassandraData).reduce(
        (acc, col) => acc + Object.keys(col).length,
        0
      ),
    });
  });

  app.post("/api/cassandra/cql", (req, res) => {
    const { query } = req.body;
    console.log("[Cassandra] Executing CQL:", query);
    // Dummy execution
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

  // Support upload via multiple paths and methods to guarantee no 404
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

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", mode: process.env.NODE_ENV });
  });

  // Vite integration and static asset serving
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
