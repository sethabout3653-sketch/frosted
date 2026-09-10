/**
 * Utility functions for robust media and file type detection,
 * formatting, and seamless direct browser downloads without URL redirects.
 */

export type MediaType = "video" | "audio" | "image" | "file";

const VIDEO_EXTENSIONS = new Set([
  "mp4", "m4v", "webm", "mkv", "mov", "avi", "wmv", "flv", "3gp", "3g2",
  "ts", "mts", "m2ts", "vob", "ogv", "divx", "asf", "mpg", "mpeg", "f4v",
  "rm", "rmvb", "webm"
]);

const AUDIO_EXTENSIONS = new Set([
  "mp3", "wav", "m4a", "aac", "flac", "ogg", "oga", "opus", "weba", "wma",
  "mid", "midi", "aiff", "aif", "ac3", "pcm", "alac", "amr", "mka"
]);

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif",
  "heic", "heif", "tiff", "tif", "raw", "psd", "ai", "eps"
]);

/**
 * Extracts a clean lowercase file extension from a filename or URL (ignoring query strings/hashes).
 */
export function getFileExtension(filenameOrUrl: string = ""): string {
  if (!filenameOrUrl) return "";
  try {
    const clean = filenameOrUrl.split("?")[0].split("#")[0];
    const lastSlash = clean.lastIndexOf("/");
    const basename = lastSlash !== -1 ? clean.slice(lastSlash + 1) : clean;
    const dotIndex = basename.lastIndexOf(".");
    if (dotIndex !== -1 && dotIndex < basename.length - 1) {
      return basename.slice(dotIndex + 1).toLowerCase();
    }
  } catch (e) {}
  return "";
}

/**
 * Extracts a clean filename from a URL or attachment string.
 */
export function getFileName(urlOrPath: string = "", fallback: string = "file"): string {
  if (!urlOrPath) return fallback;
  try {
    const clean = urlOrPath.split("?")[0].split("#")[0];
    const lastSlash = clean.lastIndexOf("/");
    const name = lastSlash !== -1 ? clean.slice(lastSlash + 1) : clean;
    return decodeURIComponent(name) || fallback;
  } catch (e) {
    return fallback;
  }
}

/**
 * Detects whether an attachment is a video, audio, image, or generic file
 * using MIME types, file extensions from both filename and URL.
 */
export function detectMediaType(
  url: string = "",
  mimeType: string = "",
  filename: string = ""
): MediaType {
  const mime = (mimeType || "").toLowerCase().trim();
  const rawUrl = (url || "").toLowerCase().trim();
  const rawName = (filename || "").toLowerCase().trim();

  // 1. Data URLs & MIME types
  if (rawUrl.startsWith("data:video/") || mime.startsWith("video/")) return "video";
  if (rawUrl.startsWith("data:audio/") || mime.startsWith("audio/")) return "audio";
  if (rawUrl.startsWith("data:image/") || mime.startsWith("image/")) return "image";

  // 2. File extension checks from both filename and URL
  const extFromFilename = getFileExtension(filename);
  const extFromUrl = getFileExtension(url);
  const ext = extFromFilename || extFromUrl;

  if (ext) {
    if (VIDEO_EXTENSIONS.has(ext)) return "video";
    if (AUDIO_EXTENSIONS.has(ext)) return "audio";
    if (IMAGE_EXTENSIONS.has(ext)) return "image";
  }

  // 3. Substring / regex fallbacks for URLs or filenames with extensions or query params
  if (/\.(mp4|webm|mov|mkv|avi|wmv|flv|m4v|ogv|ts|3gp|divx|mpg|mpeg)(\?|#|$)/i.test(rawUrl) ||
      /\.(mp4|webm|mov|mkv|avi|wmv|flv|m4v|ogv|ts|3gp|divx|mpg|mpeg)$/i.test(rawName)) {
    return "video";
  }
  if (/\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|weba|wma|aiff?)(\?|#|$)/i.test(rawUrl) ||
      /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|weba|wma|aiff?)$/i.test(rawName)) {
    return "audio";
  }
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|heic|tiff?)(\?|#|$)/i.test(rawUrl) ||
      /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|heic|tiff?)$/i.test(rawName)) {
    return "image";
  }

  // 4. Common camera / screen recording naming patterns
  if (/^(vid_|video_|screen_recording_|screen-recording_|screen_record_|clip_|mov_)/i.test(rawName)) {
    return "video";
  }
  if (/^(aud_|audio_|voice_|recording_|rec_|voice-memo_)/i.test(rawName)) {
    return "audio";
  }
  if (/^(img_|image_|photo_|pic_|screenshot_|screen_shot_)/i.test(rawName)) {
    return "image";
  }

  return "file";
}

export interface MediaProbeResult {
  type: MediaType;
  mimeType?: string;
  filename?: string;
  size?: number;
  extension?: string;
}

/**
 * Asynchronously probes the URL using the backend media-info API, HTTP headers,
 * and metadata loading to detect the true media type and metadata.
 */
export async function probeUrlMediaType(url: string): Promise<MediaProbeResult | null> {
  if (!url || url.startsWith("blob:")) return null;

  // 0. Data URL instant detection without network requests
  if (url.startsWith("data:")) {
    const match = url.match(/^data:([a-zA-Z0-9\/\-\+\.]+);/);
    if (match && match[1]) {
      const mime = match[1].toLowerCase();
      if (mime.startsWith("video/")) return { type: "video", mimeType: mime };
      if (mime.startsWith("audio/")) return { type: "audio", mimeType: mime };
      if (mime.startsWith("image/")) return { type: "image", mimeType: mime };
      return { type: "file", mimeType: mime };
    }
    return null;
  }

  // 1. Check with server-side media-info API
  try {
    const res = await fetch(`/api/media-info?url=${encodeURIComponent(url)}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.type) {
        return {
          type: data.type as MediaType,
          mimeType: data.mimeType,
          filename: data.filename,
          size: data.size,
          extension: data.extension,
        };
      }
    }
  } catch (e) {}

  // 2. Direct HEAD request
  try {
    const res = await fetch(url, { method: "HEAD" });
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.startsWith("video/")) return { type: "video", mimeType: ct };
    if (ct.startsWith("audio/")) return { type: "audio", mimeType: ct };
    if (ct.startsWith("image/")) return { type: "image", mimeType: ct };
  } catch (e) {}

  // 3. Test with video element metadata probe
  try {
    const isVideo = await new Promise<boolean>((resolve) => {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        v.src = "";
        resolve(true);
      };
      v.onerror = () => resolve(false);
      v.src = url;
      setTimeout(() => resolve(false), 1200);
    });
    if (isVideo) return { type: "video", mimeType: "video/mp4" };
  } catch (e) {}

  // 4. Test with image probe
  try {
    const isImg = await new Promise<boolean>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
      setTimeout(() => resolve(false), 1000);
    });
    if (isImg) return { type: "image", mimeType: "image/png" };
  } catch (e) {}

  return null;
}

/**
 * Returns a human-friendly category label for any file extension.
 */
export function getFileTypeBadge(filenameOrUrl: string = ""): {
  label: string;
  color: string;
  category: "pdf" | "archive" | "code" | "document" | "sheet" | "presentation" | "video" | "audio" | "image" | "file";
} {
  const ext = getFileExtension(filenameOrUrl).toLowerCase();

  if (ext === "pdf") {
    return { label: "PDF Document", color: "text-rose-400 bg-rose-500/10 border-rose-500/20", category: "pdf" };
  }
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "dmg", "pkg"].includes(ext)) {
    return { label: "Archive", color: "text-amber-400 bg-amber-500/10 border-amber-500/20", category: "archive" };
  }
  if (["js", "ts", "jsx", "tsx", "py", "java", "c", "cpp", "cs", "go", "rs", "html", "css", "json", "sql", "sh", "yaml", "yml"].includes(ext)) {
    return { label: "Source Code", color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20", category: "code" };
  }
  if (["xls", "xlsx", "csv", "tsv", "ods"].includes(ext)) {
    return { label: "Spreadsheet", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", category: "sheet" };
  }
  if (["ppt", "pptx", "odp", "key"].includes(ext)) {
    return { label: "Presentation", color: "text-orange-400 bg-orange-500/10 border-orange-500/20", category: "presentation" };
  }
  if (["doc", "docx", "txt", "rtf", "odt", "md", "pages"].includes(ext)) {
    return { label: "Document", color: "text-blue-400 bg-blue-500/10 border-blue-500/20", category: "document" };
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return { label: "Video", color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20", category: "video" };
  }
  if (AUDIO_EXTENSIONS.has(ext)) {
    return { label: "Audio", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", category: "audio" };
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    return { label: "Image", color: "text-purple-400 bg-purple-500/10 border-purple-500/20", category: "image" };
  }

  return { label: ext ? ext.toUpperCase() : "File", color: "text-neutral-400 bg-neutral-800/80 border-neutral-700/60", category: "file" };
}

/**
 * Formats a file size in bytes to a human-readable string (B, KB, MB, GB).
 */
export function formatFileSize(bytes?: number): string {
  if (!bytes || isNaN(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

/**
 * Robustly downloads any file, video, audio, image, document, archive, or script directly
 * to the user's computer using blob streams to guarantee seamless browser downloads
 * without redirects, iframe blocks, or tab navigation.
 */
export async function downloadFile(
  url: string,
  preferredFileName?: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  if (!url) return;

  const filename = preferredFileName || getFileName(url, "download");

  // 1. Data URLs & Blob URLs can be downloaded directly
  if (url.startsWith("data:") || url.startsWith("blob:")) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }

  // 2. Local uploads & proxy downloads via fetch -> Blob stream
  try {
    const targetApiUrl = url.startsWith("/uploads/") || url.startsWith("/api/")
      ? `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`
      : url;

    const response = await fetch(targetApiUrl);
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch (e) {}
    }, 30000);
    return;
  } catch (err) {
    console.warn("Direct blob download failed, attempting fallback:", err);
    // Fallback: direct proxy link trigger
    try {
      const proxyUrl = `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
      const a = document.createElement("a");
      a.href = proxyUrl;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (fallbackErr) {
      window.open(url, "_blank");
    }
  }
}
