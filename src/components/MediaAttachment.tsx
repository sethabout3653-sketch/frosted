import React, { useState, useRef, useEffect } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Download,
  FileText,
  FileCode,
  FileArchive,
  FileSpreadsheet,
  File,
  Music,
  Film,
  Image as ImageIcon,
  ExternalLink,
  X,
  Check,
  Loader2,
} from "lucide-react";
import {
  detectMediaType,
  probeUrlMediaType,
  downloadFile,
  formatFileSize,
  getFileName,
  getFileExtension,
  getFileTypeBadge,
  MediaType,
} from "../utils/mediaUtils";

interface MediaAttachmentProps {
  url: string;
  type?: string;
  name?: string;
  size?: number;
}

export default function MediaAttachment({
  url,
  type,
  name,
  size,
}: MediaAttachmentProps) {
  // Extract metadata if encoded in JSON or URL query parameters
  let initialUrl = url;
  let initialName = name;
  let initialTypeStr = type;
  let initialSizeNum = size;

  if (typeof url === "string" && url.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(url);
      if (parsed && parsed.url) {
        initialUrl = parsed.url;
        if (parsed.name && !initialName) initialName = parsed.name;
        if (parsed.type && !initialTypeStr) initialTypeStr = parsed.type;
        if (parsed.size && !initialSizeNum) initialSizeNum = parsed.size;
      }
    } catch (e) {}
  }

  if (typeof initialUrl === "string" && (initialUrl.includes("?name=") || initialUrl.includes("&name=") || initialUrl.includes("?filename="))) {
    try {
      const u = new URL(initialUrl, "https://local.dummy");
      const nameParam = u.searchParams.get("name") || u.searchParams.get("filename");
      const typeParam = u.searchParams.get("type");
      const sizeParam = u.searchParams.get("size");
      if (nameParam && !initialName) initialName = decodeURIComponent(nameParam);
      if (typeParam && !initialTypeStr) initialTypeStr = decodeURIComponent(typeParam);
      if (sizeParam && !initialSizeNum) initialSizeNum = parseInt(sizeParam, 10);
    } catch (e) {}
  }

  const initialType = detectMediaType(initialUrl, initialTypeStr, initialName);
  const [effectiveType, setEffectiveType] = useState<MediaType>(initialType);
  const [effectiveName, setEffectiveName] = useState<string>(
    initialName || getFileName(initialUrl, "attachment")
  );
  const [effectiveSize, setEffectiveSize] = useState<number | undefined>(initialSizeNum);

  const displayName = effectiveName;
  const ext = getFileExtension(displayName || initialUrl).toUpperCase();
  const fileBadge = getFileTypeBadge(displayName || initialUrl);

  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [isUnavailable, setIsUnavailable] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const [displayUrl, setDisplayUrl] = useState<string>(initialUrl);

  // Probe media metadata in background to accurately recognize ANY file type
  useEffect(() => {
    let isMounted = true;
    let activeUrl = url;
    let activeName = name;
    let activeType = type;
    let activeSize = size;

    if (typeof url === "string" && url.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(url);
        if (parsed && parsed.url) {
          activeUrl = parsed.url;
          if (parsed.name && !activeName) activeName = parsed.name;
          if (parsed.type && !activeType) activeType = parsed.type;
          if (parsed.size && !activeSize) activeSize = parsed.size;
        }
      } catch (e) {}
    }

    if (typeof activeUrl === "string" && (activeUrl.includes("?name=") || activeUrl.includes("&name=") || activeUrl.includes("?filename="))) {
      try {
        const u = new URL(activeUrl, "https://local.dummy");
        const nameParam = u.searchParams.get("name") || u.searchParams.get("filename");
        const typeParam = u.searchParams.get("type");
        const sizeParam = u.searchParams.get("size");
        if (nameParam && !activeName) activeName = decodeURIComponent(nameParam);
        if (typeParam && !activeType) activeType = decodeURIComponent(typeParam);
        if (sizeParam && !activeSize) activeSize = parseInt(sizeParam, 10);
      } catch (e) {}
    }

    const detected = detectMediaType(activeUrl, activeType, activeName);
    setEffectiveType(detected);
    const resolvedName = activeName || getFileName(activeUrl, "attachment");
    setEffectiveName(resolvedName);
    if (activeSize) setEffectiveSize(activeSize);
    setDisplayUrl(activeUrl);

    if (activeUrl) {
      // 0. Convert Data URLs to Blob URLs for better media playback stability
      if (activeUrl.startsWith("data:")) {
        fetch(activeUrl)
          .then(res => res.blob())
          .then(blob => {
            if (!isMounted) return;
            const blobUrl = URL.createObjectURL(blob);
            setDisplayUrl(blobUrl);
          })
          .catch(e => console.warn("Failed to convert data URL to blob", e));
      }

      // If we are on static hosting and trying to load a local /uploads/ path, it's missing.
      if (activeUrl.startsWith("/uploads/") || activeUrl.startsWith("/api/")) {
        fetch(activeUrl, { method: "HEAD" }).then(res => {
          if (!isMounted) return;
          const contentType = res.headers.get("content-type") || "";
          if (contentType.includes("text/html") && !activeUrl.toLowerCase().endsWith(".html")) {
            setIsUnavailable(true);
          }
        }).catch(() => {
          if (isMounted) setIsUnavailable(true);
        });
      }

      probeUrlMediaType(activeUrl).then((probed) => {
        if (!isMounted || !probed) return;
        if (probed.type) {
          setEffectiveType(probed.type);
        }
        // Only update filename from probe if activeName is completely missing or generic
        if (probed.filename && (!activeName || activeName === "attachment" || activeName.startsWith("file_") || !activeName.includes("."))) {
          setEffectiveName(probed.filename);
        }
        if (probed.size && !activeSize) {
          setEffectiveSize(probed.size);
        }
      });
    }

    return () => {
      isMounted = false;
    };
  }, [url, type, name, size]);

  useEffect(() => {
    return () => {
      if (displayUrl && displayUrl.startsWith("blob:")) {
        URL.revokeObjectURL(displayUrl);
      }
    };
  }, [displayUrl]);

  const handleDownloadClick = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (isDownloading || isUnavailable) return;

    setIsDownloading(true);
    try {
      let finalName = displayName;
      if (!finalName.includes(".")) {
        const detectedExt = (ext || "").toLowerCase() || getFileExtension(displayUrl || url);
        if (detectedExt) finalName = `${finalName}.${detectedExt}`;
      }
      await downloadFile(displayUrl || url, finalName);
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 2500);
    } catch (err) {
      console.error("Download failed:", err);
    } finally {
      setIsDownloading(false);
    }
  };

  if (isUnavailable) {
    return (
      <div className="mt-2.5 max-w-sm w-fit inline-flex items-center gap-3 p-3 rounded-xl border border-red-500/20 bg-red-500/10 shadow-sm relative overflow-hidden">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-red-500/20 flex-shrink-0">
          <FileText size={20} className="text-red-400" />
        </div>
        <div className="min-w-0 pr-4">
          <p className="text-sm font-semibold text-red-200 truncate" title={displayName}>
            {displayName}
          </p>
          <p className="text-xs text-red-400 mt-0.5 font-medium truncate">
            File no longer available
          </p>
        </div>
      </div>
    );
  }

  // 1. Image Attachment
  if (effectiveType === "image") {
    return (
      <>
        <div className="mt-2.5 max-w-sm sm:max-w-md group relative rounded-xl overflow-hidden border border-neutral-800/80 bg-neutral-950/60 shadow-lg transition-all duration-200 hover:border-neutral-700">
          <div
            onClick={() => setShowModal(true)}
            className="cursor-zoom-in relative overflow-hidden flex items-center justify-center bg-black/40 min-h-[140px]"
          >
            <img
              src={displayUrl}
              alt={displayName}
              loading="lazy"
              className="w-full h-auto max-h-80 object-contain rounded-t-xl group-hover:scale-[1.01] transition-transform duration-200"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none" />
          </div>

          <div className="px-3 py-2 bg-neutral-900/90 border-t border-neutral-800/60 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <ImageIcon size={14} className="text-neutral-400 flex-shrink-0" />
              <span className="text-xs font-medium text-neutral-300 truncate" title={displayName}>
                {displayName}
              </span>
              {size ? (
                <span className="text-[10px] text-neutral-500 font-mono flex-shrink-0">
                  {formatFileSize(size)}
                </span>
              ) : null}
            </div>

            <button
              onClick={handleDownloadClick}
              disabled={isDownloading}
              className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition-all border border-neutral-700/60 shadow-sm flex-shrink-0 flex items-center gap-1 text-[11px]"
              title="Download image"
            >
              {isDownloading ? (
                <Loader2 size={13} className="animate-spin text-indigo-400" />
              ) : downloadSuccess ? (
                <Check size={13} className="text-emerald-400" />
              ) : (
                <Download size={13} />
              )}
            </button>
          </div>
        </div>

        {/* Full Image Modal */}
        {showModal && (
          <div
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 animate-in fade-in duration-200"
            onClick={() => setShowModal(false)}
          >
            <div
              className="relative max-w-5xl max-h-[90vh] flex flex-col items-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="absolute -top-12 right-0 flex items-center gap-2">
                <button
                  onClick={handleDownloadClick}
                  className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-medium flex items-center gap-1.5 transition-colors border border-neutral-700 shadow-md"
                >
                  <Download size={14} />
                  Download
                </button>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors border border-neutral-700 shadow-md"
                >
                  <X size={18} />
                </button>
              </div>
              <img
                src={displayUrl}
                alt={displayName}
                className="max-w-full max-h-[80vh] object-contain rounded-xl border border-neutral-800 shadow-2xl"
              />
              <span className="text-xs text-neutral-400 mt-2 font-mono">
                {displayName} {size ? `(${formatFileSize(size)})` : ""}
              </span>
            </div>
          </div>
        )}
      </>
    );
  }

  // 2. Video Attachment
  if (effectiveType === "video") {
    return (
      <>
        <div className="mt-2.5 max-w-md w-full rounded-2xl overflow-hidden border border-neutral-800/90 bg-neutral-950/80 shadow-xl group">
          {/* Header with Title & Download */}
          <div className="px-3.5 py-2 bg-neutral-900/90 border-b border-neutral-800/80 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-5 h-5 rounded-md bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 flex-shrink-0">
                <Film size={12} />
              </div>
              <span className="text-xs font-semibold text-neutral-200 truncate" title={displayName}>
                {displayName}
              </span>
              {ext && (
                <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-[9px] font-mono font-bold text-neutral-400">
                  {ext}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => setShowModal(true)}
                className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors border border-neutral-700/60"
                title="Theater mode / Fullscreen"
              >
                <Maximize2 size={13} />
              </button>
              <button
                onClick={handleDownloadClick}
                disabled={isDownloading}
                className="px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white transition-all border border-neutral-700/60 shadow-sm flex items-center gap-1.5 text-xs font-medium"
                title="Download video file"
              >
                {isDownloading ? (
                  <Loader2 size={13} className="animate-spin text-indigo-400" />
                ) : downloadSuccess ? (
                  <>
                    <Check size={13} className="text-emerald-400" />
                    <span className="text-[11px] text-emerald-400">Saved</span>
                  </>
                ) : (
                  <>
                    <Download size={13} />
                    <span className="text-[11px]">Download</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Embedded Video Player */}
          <div className="relative bg-black flex items-center justify-center min-h-[160px]">
            <video
              ref={videoRef}
              src={displayUrl}
              controls
              playsInline
              preload="metadata"
              onError={() => setVideoError(true)}
              className="w-full max-h-[380px] object-contain rounded-b-xl"
            />

            {videoError && (
              <div className="absolute inset-0 bg-neutral-950/95 flex flex-col items-center justify-center p-4 text-center gap-2.5">
                <Film size={28} className="text-neutral-500" />
                <div>
                  <p className="text-xs font-semibold text-neutral-300">
                    Video format requires external player
                  </p>
                  <p className="text-[11px] text-neutral-500 mt-0.5">
                    Download file to watch in your preferred video application
                  </p>
                </div>
                <button
                  onClick={handleDownloadClick}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1.5 transition-colors shadow-md"
                >
                  <Download size={13} />
                  Download Video ({ext})
                </button>
              </div>
            )}
          </div>

          {size ? (
            <div className="px-3.5 py-1.5 bg-neutral-950 text-[10px] text-neutral-500 border-t border-neutral-900 font-mono">
              Size: {formatFileSize(size)}
            </div>
          ) : null}
        </div>

        {/* Fullscreen Video Theater Modal */}
        {showModal && (
          <div
            className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col items-center justify-center p-4 animate-in fade-in duration-200"
            onClick={() => setShowModal(false)}
          >
            <div
              className="relative w-full max-w-4xl bg-neutral-950 border border-neutral-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-3 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Film size={16} className="text-indigo-400" />
                  <span className="text-sm font-bold text-white truncate">
                    {displayName}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDownloadClick}
                    className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-medium flex items-center gap-1.5 transition-colors border border-neutral-700"
                  >
                    <Download size={14} />
                    Download Video
                  </button>
                  <button
                    onClick={() => setShowModal(false)}
                    className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors border border-neutral-700"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
              <div className="bg-black flex items-center justify-center max-h-[75vh]">
                <video
                  src={displayUrl}
                  controls
                  autoPlay
                  playsInline
                  className="w-full max-h-[70vh] object-contain"
                />
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // 3. Audio Attachment
  if (effectiveType === "audio") {
    return (
      <div className="mt-2.5 max-w-sm sm:max-w-md w-full bg-neutral-900/80 p-3.5 rounded-2xl border border-neutral-800 shadow-md flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 flex-shrink-0">
              <Music size={16} />
            </div>
            <div className="min-w-0">
              <span className="text-xs font-bold text-neutral-200 truncate block" title={displayName}>
                {displayName}
              </span>
              <span className="text-[10px] text-neutral-500 font-mono">
                {ext ? `${ext} • ` : ""}{formatFileSize(size) || "Audio track"}
              </span>
            </div>
          </div>

          <button
            onClick={handleDownloadClick}
            disabled={isDownloading}
            className="p-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition-all border border-neutral-700/60 shadow-sm flex-shrink-0"
            title="Download audio track"
          >
            {isDownloading ? (
              <Loader2 size={14} className="animate-spin text-emerald-400" />
            ) : downloadSuccess ? (
              <Check size={14} className="text-emerald-400" />
            ) : (
              <Download size={14} />
            )}
          </button>
        </div>

        <audio
          ref={audioRef}
          src={displayUrl}
          controls
          className="w-full h-8 rounded-lg"
        />
      </div>
    );
  }

  // Helper to render appropriate file icon based on category
  const renderFileCategoryIcon = () => {
    switch (fileBadge.category) {
      case "pdf":
        return <FileText size={20} className="text-rose-400" />;
      case "archive":
        return <FileArchive size={20} className="text-amber-400" />;
      case "code":
        return <FileCode size={20} className="text-cyan-400" />;
      case "sheet":
        return <FileSpreadsheet size={20} className="text-emerald-400" />;
      case "presentation":
        return <FileText size={20} className="text-orange-400" />;
      default:
        return <FileText size={20} className="text-neutral-400 group-hover:text-indigo-400" />;
    }
  };

  // 4. Generic & Structured Files (Document, Archive, Executable, Code, PDF, etc.)
  return (
    <div className="mt-2.5 max-w-sm sm:max-w-md p-3 bg-neutral-900/90 hover:bg-neutral-850 border border-neutral-800/90 hover:border-neutral-700/80 rounded-2xl flex items-center justify-between gap-3 shadow-md group transition-all duration-200">
      <div 
        onClick={handleDownloadClick}
        className="flex items-center gap-3 min-w-0 cursor-pointer flex-1"
      >
        <div className="w-10 h-10 rounded-xl bg-neutral-800 border border-neutral-700 flex items-center justify-center flex-shrink-0 group-hover:border-neutral-600 transition-colors">
          {renderFileCategoryIcon()}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-bold text-neutral-100 truncate group-hover:text-indigo-200 transition-colors" title={displayName}>
            {displayName}
          </span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${fileBadge.color}`}>
              {fileBadge.label}
            </span>
            {effectiveSize ? (
              <span className="text-[10px] text-neutral-400 font-mono">
                {formatFileSize(effectiveSize)}
              </span>
            ) : (
              <span className="text-[10px] text-neutral-500 font-mono">
                Click to download
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Quick Play button if user wants to force try media preview */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setEffectiveType("video");
          }}
          className="p-1.5 bg-neutral-800 hover:bg-indigo-600/80 text-neutral-300 hover:text-white rounded-lg transition-all border border-neutral-700 shadow-sm flex items-center gap-1 text-[11px] font-medium"
          title="Play as video/media"
        >
          <Play size={12} fill="currentColor" />
          <span className="hidden sm:inline text-[10px]">Play</span>
        </button>

        {/* Direct Download Button */}
        <button
          onClick={handleDownloadClick}
          disabled={isDownloading}
          className="p-1.5 bg-neutral-800 hover:bg-indigo-600 text-neutral-300 hover:text-white rounded-lg transition-all border border-neutral-700 shadow-sm flex items-center justify-center"
          title="Download file directly"
        >
          {isDownloading ? (
            <Loader2 size={13} className="animate-spin text-white" />
          ) : downloadSuccess ? (
            <Check size={13} className="text-emerald-400" />
          ) : (
            <Download size={13} />
          )}
        </button>
      </div>
    </div>
  );
}
