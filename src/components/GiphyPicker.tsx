import React, { useState, useEffect, useCallback, useRef } from "react";
import { Search, X, Loader2, Sparkles, RefreshCw, ExternalLink } from "lucide-react";
import { GiphyFetch } from "@giphy/js-fetch-api";

// Active working Giphy API key
const GIPHY_API_KEY = "GlVGYHkr3WSBnllca54iNt0yFbjz7L65";
const gf = new GiphyFetch(GIPHY_API_KEY);

interface GiphyPickerProps {
  onSelectGif: (url: string) => void;
  onClose: () => void;
}

interface GifItem {
  id: string;
  url: string;
  previewUrl: string;
  title: string;
}

// Curated popular fallback GIFs in case of API rate limits
const FALLBACK_GIFS: GifItem[] = [
  {
    id: "fb-1",
    url: "https://media.giphy.com/media/v1.Y2lkPWE1YTU4ZDcwYTQ3M2JqOW13b2dxeHhmMHA1ZmgwY2tkd2FkaHZlN3MyOTlzMWNrZCZlcD12MV9naWZzX3RyZW5kaW5nJmN0PWc/2TsWJ6YrglkthfS0ru/200.gif",
    previewUrl: "https://media.giphy.com/media/v1.Y2lkPWE1YTU4ZDcwYTQ3M2JqOW13b2dxeHhmMHA1ZmgwY2tkd2FkaHZlN3MyOTlzMWNrZCZlcD12MV9naWZzX3RyZW5kaW5nJmN0PWc/2TsWJ6YrglkthfS0ru/200.gif",
    title: "Tom and Jerry smile",
  },
  {
    id: "fb-2",
    url: "https://media.giphy.com/media/v1.Y2lkPWE1YTU4ZDcwY2d2ZzRtaW43NnZxeHY2enhrdmFsa2hkMXBpeDRtNzNtODJ1NGp6aSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/y0NFayaBeiWEU/200.gif",
    previewUrl: "https://media.giphy.com/media/v1.Y2lkPWE1YTU4ZDcwY2d2ZzRtaW43NnZxeHY2enhrdmFsa2hkMXBpeDRtNzNtODJ1NGp6aSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/y0NFayaBeiWEU/200.gif",
    title: "Gamer victory celebration",
  },
  {
    id: "fb-3",
    url: "https://media.giphy.com/media/v1.Y2lkPWE1YTU4ZDcwbnloZDRjNjI0ZmhuYjVtbGdpbHh5MzB2NGw3Y2lleXNvZnRucnpmZyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/OfkGZ5H2H3f8Y/200.gif",
    previewUrl: "https://media.giphy.com/media/v1.Y2lkPWE1YTU4ZDcwbnloZDRjNjI0ZmhuYjVtbGdpbHh5MzB2NGw3Y2lleXNvZnRucnpmZyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/OfkGZ5H2H3f8Y/200.gif",
    title: "Excited dance",
  },
  {
    id: "fb-4",
    url: "https://media.giphy.com/media/v1.Y2lkPWE1YTU4ZDcwNjZzN3g2eXh1NHl5b2pmaDZ3czl2YTVuM3F1eTNhNGpxeWFhYXN5ZCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/artj92V8o75VPL7AeQ/200.gif",
    previewUrl: "https://media.giphy.com/media/v1.Y2lkPWE1YTU4ZDcwNjZzN3g2eXh1NHl5b2pmaDZ3czl2YTVuM3F1eTNhNGpxeWFhYXN5ZCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/artj92V8o75VPL7AeQ/200.gif",
    title: "Popcorn meme",
  },
  {
    id: "fb-5",
    url: "https://media.giphy.com/media/v1.Y2lkPWE1YTU4ZDcwczJubWhpdXZrZXVjcTNrczlkazVxdWJ2MXZidGFsNWhqbzY4cTczNiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/l3q2K5jinAlChoCLS/200.gif",
    previewUrl: "https://media.giphy.com/media/v1.Y2lkPWE1YTU4ZDcwczJubWhpdXZrZXVjcTNrczlkazVxdWJ2MXZidGFsNWhqbzY4cTczNiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/l3q2K5jinAlChoCLS/200.gif",
    title: "Blinking white guy",
  },
  {
    id: "fb-6",
    url: "https://media.giphy.com/media/v1.Y2lkPWE1YTU4ZDcwbGN0Mmw0c2Y1ODl0cXFubmhldjQ1NHk4Nmt5MXdtMXN2Y2J3dDZtayZlcD12MV9naWZzX3NlYXJjaCZjdD1n/DhstvI3CH0nYu9762T/200.gif",
    previewUrl: "https://media.giphy.com/media/v1.Y2lkPWE1YTU4ZDcwbGN0Mmw0c2Y1ODl0cXFubmhldjQ1NHk4Nmt5MXdtMXN2Y2J3dDZtayZlcD12MV9naWZzX3NlYXJjaCZjdD1n/DhstvI3CH0nYu9762T/200.gif",
    title: "Cat dancing vibing",
  },
  {
    id: "fb-7",
    url: "https://media.giphy.com/media/v1.Y2lkPWE1YTU4ZDcwb3l0ZmI4Z29qOXVvaWZpdnNyZ2M3cmFvN24xODhnbnQ4MmtzYTRnMSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/NEvPzZ8bd1V4Y/200.gif",
    previewUrl: "https://media.giphy.com/media/v1.Y2lkPWE1YTU4ZDcwb3l0ZmI4Z29qOXVvaWZpdnNyZ2M3cmFvN24xODhnbnQ4MmtzYTRnMSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/NEvPzZ8bd1V4Y/200.gif",
    title: "Jeremiah Johnson nodding",
  },
  {
    id: "fb-8",
    url: "https://media.giphy.com/media/v1.Y2lkPWE1YTU4ZDcwbjR4cTdmNDBhaG9wZHNrbW1jOHU2eGN1YnVldGFsaDZlbXhsbjRmdSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/xT9IgG50Fb7Mi0prBC/200.gif",
    previewUrl: "https://media.giphy.com/media/v1.Y2lkPWE1YTU4ZDcwbjR4cTdmNDBhaG9wZHNrbW1jOHU2eGN1YnVldGFsaDZlbXhsbjRmdSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/xT9IgG50Fb7Mi0prBC/200.gif",
    title: "Mind blown explosion",
  }
];

const CATEGORIES = [
  "Trending",
  "Gaming",
  "Laugh",
  "Memes",
  "Anime",
  "Reactions",
  "GG",
  "Cat",
  "Dancing",
];

export const GiphyPicker: React.FC<GiphyPickerProps> = ({
  onSelectGif,
  onClose,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState("Trending");
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [customUrl, setCustomUrl] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const fetchGiphyData = useCallback(async (query: string) => {
    setLoading(true);
    try {
      let result;
      if (!query || query === "Trending") {
        result = await gf.trending({ limit: 24, rating: "pg-13" });
      } else {
        result = await gf.search(query, {
          limit: 24,
          sort: "relevant",
          lang: "en",
          rating: "pg-13",
        });
      }

      if (result && result.data && result.data.length > 0) {
        const formatted: GifItem[] = result.data.map((item: any) => ({
          id: item.id,
          url: item.images?.fixed_height?.url || item.images?.original?.url || "",
          previewUrl: item.images?.fixed_height_small?.url || item.images?.fixed_height?.url || "",
          title: item.title || "GIPHY GIF",
        }));
        setGifs(formatted);
      } else {
        // Fallback to curated collection if query returned 0 items
        setGifs(FALLBACK_GIFS);
      }
    } catch (err) {
      console.warn("Giphy fetch failed, using fallback library:", err);
      setGifs(FALLBACK_GIFS);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on initial load or category change
  useEffect(() => {
    if (activeCategory === "Trending" && !searchTerm) {
      fetchGiphyData("Trending");
    } else if (activeCategory !== "Trending" && !searchTerm) {
      fetchGiphyData(activeCategory);
    }
  }, [activeCategory, searchTerm, fetchGiphyData]);

  // Debounced search when user types in search bar
  useEffect(() => {
    if (!searchTerm.trim()) return;

    const timer = setTimeout(() => {
      fetchGiphyData(searchTerm.trim());
    }, 350);

    return () => clearTimeout(timer);
  }, [searchTerm, fetchGiphyData]);

  const handleSelectCategory = (cat: string) => {
    setActiveCategory(cat);
    setSearchTerm("");
  };

  const handleCustomUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customUrl.trim()) {
      onSelectGif(customUrl.trim());
      onClose();
    }
  };

  return (
    <div
      id="giphy-picker-drawer"
      className="border-t border-neutral-800 bg-[#0d0d0d] flex flex-col h-72 sm:h-80 flex-shrink-0 animate-in slide-in-from-bottom duration-200 select-none shadow-2xl"
    >
      {/* Drawer Header */}
      <div className="px-3 py-2 border-b border-neutral-800/80 flex items-center justify-between gap-2 flex-shrink-0 bg-neutral-900/60">
        <div className="flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-white font-bold text-[10px] tracking-wider uppercase">
            GIF
          </span>
          <span className="text-xs font-semibold text-neutral-200">
            Choose a GIF
          </span>
          <span className="text-[10px] text-neutral-500 hidden sm:inline">
            Powered by GIPHY
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowUrlInput(!showUrlInput)}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
              showUrlInput
                ? "bg-white text-black border-white"
                : "bg-neutral-800 text-neutral-400 border-neutral-700 hover:text-white"
            }`}
            title="Paste custom GIF link"
          >
            URL
          </button>
          <button
            type="button"
            onClick={() => fetchGiphyData(searchTerm || activeCategory)}
            className="p-1 text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors"
            title="Refresh GIFs"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors"
            title="Close GIF Picker"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Custom URL Input Field (Optional Bar) */}
      {showUrlInput && (
        <form
          onSubmit={handleCustomUrlSubmit}
          className="p-2 bg-neutral-950 border-b border-neutral-800 flex items-center gap-2 flex-shrink-0"
        >
          <input
            type="url"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="Paste direct .gif URL here..."
            className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-2.5 py-1 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-700"
          />
          <button
            type="submit"
            disabled={!customUrl.trim()}
            className="px-3 py-1 bg-white hover:bg-neutral-200 text-black text-xs font-semibold rounded disabled:opacity-40"
          >
            Send
          </button>
        </form>
      )}

      {/* Search Input Bar */}
      <div className="p-2 border-b border-neutral-800/80 bg-neutral-950 flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500 w-3.5 h-3.5" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search GIPHY for memes, reactions, gaming..."
            className="w-full bg-neutral-900/90 border border-neutral-800 text-xs text-white placeholder-neutral-500 rounded-lg pl-8 pr-7 py-1.5 focus:outline-none focus:border-neutral-600 transition-colors"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm("");
                setActiveCategory("Trending");
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Categories Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-2 pb-0.5 no-scrollbar">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => handleSelectCategory(cat)}
              className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium whitespace-nowrap transition-all cursor-pointer ${
                activeCategory === cat && !searchTerm
                  ? "bg-white text-black font-semibold shadow"
                  : "bg-neutral-900 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 border border-neutral-800/80"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* GIF Grid Area */}
      <div className="flex-1 overflow-y-auto p-2 min-h-0 bg-[#0a0a0a]">
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-neutral-500 py-8">
            <Loader2 size={24} className="animate-spin text-neutral-400" />
            <span className="text-xs">Fetching GIFs from GIPHY...</span>
          </div>
        ) : gifs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-neutral-500 py-8 text-center">
            <Sparkles size={20} className="text-neutral-600" />
            <span className="text-xs">No GIFs found for this search.</span>
            <button
              onClick={() => {
                setSearchTerm("");
                setActiveCategory("Trending");
              }}
              className="text-xs text-white hover:underline mt-1"
            >
              View Trending GIFs
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {gifs.map((gif) => (
              <button
                key={gif.id}
                type="button"
                onClick={() => {
                  onSelectGif(gif.url);
                  onClose();
                }}
                className="group relative aspect-video bg-neutral-900 rounded-lg overflow-hidden border border-neutral-800/80 hover:border-neutral-500 focus:outline-none transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
                title={gif.title}
              >
                <img
                  src={gif.previewUrl || gif.url}
                  alt={gif.title}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-1.5">
                  <span className="text-[10px] text-white font-medium truncate drop-shadow">
                    {gif.title || "Send GIF"}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default GiphyPicker;
