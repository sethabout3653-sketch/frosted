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

  // 1. Data URLs
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

  // 3. Substring / regex fallbacks for URLs with params or special patterns
  if (/\.(mp4|webm|mov|mkv|avi|wmv|flv|m4v|ogv|ts|3gp)(\?|#|$)/i.test(rawUrl)) {
    return "video";
  }
  if (/\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|weba|wma)(\?|#|$)/i.test(rawUrl)) {
    return "audio";
  }
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|heic|tiff?)(\?|#|$)/i.test(rawUrl)) {
    return "image";
  }

  return "file";
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
 * Robustly downloads any file, video, audio, or image directly to the user's
 * computer without redirecting or navigating the browser away.
 */
export async function downloadFile(
  url: string,
  preferredFileName?: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  if (!url) return;

  const filename = preferredFileName || getFileName(url, "download");

  // 1. Data URLs & Blob URLs can be downloaded instantly via programmatic anchor
  if (url.startsWith("data:") || url.startsWith("blob:")) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }

  // 2. If it's a local /uploads/ URL, we can use the server download route with Content-Disposition
  if (url.startsWith("/uploads/")) {
    const proxyUrl = `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = proxyUrl;
    document.body.appendChild(iframe);
    setTimeout(() => {
      try {
        document.body.removeChild(iframe);
      } catch (e) {}
    }, 15000);
    return;
  }

  // 3. For remote or other URLs, fetch as Blob to bypass browser cross-origin redirect behavior
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  } catch (err) {
    // 4. If direct fetch fails (e.g. CORS restrictions on external server), use backend proxy
    try {
      const proxyUrl = `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
      const a = document.createElement("a");
      a.href = proxyUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (fallbackErr) {
      // 5. Final fallback in new window
      window.open(url, "_blank");
    }
  }
}
