import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Snowflake, Sparkles, Coffee } from "lucide-react";
import {
  ThemeRgb,
  getSavedTheme,
  calculateThemeShades,
} from "../utils/theme";

interface LoadingScreenProps {
  onComplete: () => void;
  themeColor?: ThemeRgb;
}

const FRIENDLY_PHRASES = [
  "Warming up your study space...",
  "Gathering your channels & desks...",
  "Setting up the cozy vibes...",
  "Almost ready for you...",
];

export default function LoadingScreen({ onComplete, themeColor }: LoadingScreenProps) {
  const [progress, setProgress] = useState(15);
  const [phraseIndex, setPhraseIndex] = useState(0);

  // Active theme color (defaults to saved color from color wheel or prop)
  const [currentTheme, setCurrentTheme] = useState<ThemeRgb>(() => themeColor || getSavedTheme());

  // Listen to live color updates from color wheel
  useEffect(() => {
    if (themeColor) {
      setCurrentTheme(themeColor);
    }
  }, [themeColor]);

  useEffect(() => {
    const handleThemeUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<ThemeRgb>;
      if (customEvent.detail && typeof customEvent.detail.r === "number") {
        setCurrentTheme(customEvent.detail);
      } else {
        setCurrentTheme(getSavedTheme());
      }
    };

    window.addEventListener("frosted-theme-change", handleThemeUpdate);
    window.addEventListener("storage", handleThemeUpdate);
    return () => {
      window.removeEventListener("frosted-theme-change", handleThemeUpdate);
      window.removeEventListener("storage", handleThemeUpdate);
    };
  }, []);

  // Compute reactive theme shades derived from color wheel
  const shades = calculateThemeShades(currentTheme.r, currentTheme.g, currentTheme.b);

  useEffect(() => {
    // Smooth, natural progress progression
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(progressInterval);
          return 100;
        }
        // Organic, slightly variable increments
        const delta = Math.floor(Math.random() * 8) + 6;
        return Math.min(100, prev + delta);
      });
    }, 110);

    // Rotate friendly warm messages
    const phraseInterval = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % FRIENDLY_PHRASES.length);
    }, 450);

    // Smooth completion after ~1.6 seconds
    const completeTimer = setTimeout(() => {
      setProgress(100);
      onComplete();
    }, 1600);

    return () => {
      clearInterval(progressInterval);
      clearInterval(phraseInterval);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <motion.div
      key="loading-screen-root"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{
        opacity: 0,
        scale: 1.04,
        filter: "blur(10px)",
        transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
      }}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden select-none text-white cursor-wait"
      style={{
        backgroundColor: shades.darkest,
        pointerEvents: "auto",
      }}
    >
      {/* Warm & Cozy Ambient Backdrop listening to Color Wheel */}
      <div
        className="absolute inset-0 pointer-events-none transition-all duration-300"
        style={{
          background: `radial-gradient(ellipse at 50% 40%, rgba(${currentTheme.r}, ${currentTheme.g}, ${currentTheme.b}, 0.28) 0%, rgba(${Math.round(currentTheme.r * 0.35 + 5)}, ${Math.round(currentTheme.g * 0.35 + 7)}, ${Math.round(currentTheme.b * 0.35 + 20)}, 0.45) 45%, ${shades.darkest} 85%)`,
        }}
      />

      {/* Gentle Floating Atmospheric Glows derived from Color Wheel */}
      <motion.div
        animate={{
          scale: [1, 1.15, 1],
          opacity: [0.4, 0.65, 0.4],
        }}
        transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
        className="absolute w-96 h-96 rounded-full blur-3xl pointer-events-none transition-colors duration-300"
        style={{
          backgroundColor: `rgba(${currentTheme.r}, ${currentTheme.g}, ${currentTheme.b}, 0.25)`,
        }}
      />
      <motion.div
        animate={{
          scale: [1.1, 0.95, 1.1],
          opacity: [0.2, 0.4, 0.2],
        }}
        transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
        className="absolute w-80 h-80 rounded-full blur-3xl pointer-events-none -translate-y-8 translate-x-12 transition-colors duration-300"
        style={{
          backgroundColor: shades.ind400,
          opacity: 0.18,
        }}
      />

      {/* Soft Drifting Sparkles / Floating Particles tinted by theme */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-50">
        <motion.div
          animate={{ y: [0, -20, 0], opacity: [0.3, 0.8, 0.3] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-[22%] left-[24%]"
          style={{ color: shades.ind300 }}
        >
          <Sparkles size={14} />
        </motion.div>
        <motion.div
          animate={{ y: [0, -15, 0], opacity: [0.2, 0.7, 0.2] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut", delay: 0.8 }}
          className="absolute top-[30%] right-[22%]"
          style={{ color: shades.ind200 }}
        >
          <Sparkles size={12} />
        </motion.div>
        <motion.div
          animate={{ y: [0, -18, 0], opacity: [0.25, 0.75, 0.25] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut", delay: 1.2 }}
          className="absolute bottom-[28%] left-[28%]"
          style={{ color: shades.ind400 }}
        >
          <Sparkles size={13} />
        </motion.div>
        <motion.div
          animate={{ y: [0, -16, 0], opacity: [0.2, 0.6, 0.2] }}
          transition={{ duration: 3.8, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
          className="absolute bottom-[34%] right-[26%]"
          style={{ color: shades.textAccent }}
        >
          <Sparkles size={15} />
        </motion.div>
      </div>

      {/* Main Content Area */}
      <div className="relative z-10 flex flex-col items-center px-4 max-w-sm w-full text-center">
        {/* Cozy Frosted Emblem */}
        <div className="relative mb-6">
          {/* Subtle Ambient Halo tinted by Color Wheel */}
          <div
            className="absolute -inset-2 rounded-3xl blur-xl opacity-75 transition-all duration-300"
            style={{
              background: `linear-gradient(135deg, ${shades.ind500} 0%, ${shades.accentHover} 100%)`,
            }}
          />

          {/* Icon Badge */}
          <motion.div
            animate={{
              y: [0, -6, 0],
              rotate: [0, 1.5, -1.5, 0],
            }}
            transition={{
              duration: 2.8,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="relative w-24 h-24 rounded-3xl border shadow-2xl backdrop-blur-xl flex items-center justify-center transition-colors duration-300"
            style={{
              background: `linear-gradient(145deg, rgba(${currentTheme.r}, ${currentTheme.g}, ${currentTheme.b}, 0.65) 0%, ${shades.surface} 50%, ${shades.darkest} 100%)`,
              borderColor: shades.borderStrong,
              boxShadow: `0 10px 35px rgba(${Math.round(currentTheme.r * 0.15)}, ${Math.round(currentTheme.g * 0.15)}, ${Math.round(currentTheme.b * 0.15)}, 0.65)`,
            }}
          >
            <Snowflake
              size={42}
              style={{
                color: shades.ind100,
                filter: `drop-shadow(0 0 16px ${shades.ind400})`,
              }}
              strokeWidth={1.75}
            />
            <motion.div
              animate={{ rotate: [0, 15, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full border flex items-center justify-center backdrop-blur-sm transition-colors duration-300"
              style={{
                backgroundColor: `rgba(${currentTheme.r}, ${currentTheme.g}, ${currentTheme.b}, 0.4)`,
                borderColor: shades.borderStrong,
              }}
            >
              <Sparkles size={12} style={{ color: shades.ind200 }} />
            </motion.div>
          </motion.div>
        </div>

        {/* Friendly Brand Title */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="flex flex-col items-center"
        >
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            Frosted Studying
          </h1>
          <p
            className="mt-1 text-xs flex items-center gap-1.5 transition-colors duration-300"
            style={{ color: shades.ind200 }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse transition-colors duration-300"
              style={{ backgroundColor: shades.ind400 }}
            />
            Your cozy study hub & community
          </p>
        </motion.div>

        {/* Human, Friendly Status Message */}
        <div className="h-7 mt-6 flex items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.p
              key={phraseIndex}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="text-xs sm:text-sm font-medium flex items-center gap-1.5 transition-colors duration-300"
              style={{ color: shades.ind100 }}
            >
              <Coffee size={13} style={{ color: shades.ind300 }} className="shrink-0" />
              {FRIENDLY_PHRASES[phraseIndex]}
            </motion.p>
          </AnimatePresence>
        </div>

        {/* Soft, Fluid Progress Bar */}
        <div className="mt-4 w-52 sm:w-60">
          <div
            className="relative w-full h-2 rounded-full border overflow-hidden shadow-inner transition-colors duration-300"
            style={{
              backgroundColor: shades.surface,
              borderColor: shades.border,
            }}
          >
            <motion.div
              className="h-full rounded-full relative overflow-hidden transition-all duration-300"
              style={{
                background: `linear-gradient(to right, ${shades.ind600}, ${shades.ind400}, ${shades.ind200})`,
                width: `${progress}%`,
              }}
              transition={{ ease: "easeOut", duration: 0.15 }}
            >
              {/* Soft light shimmer sweep */}
              <motion.div
                animate={{ x: ["-100%", "200%"] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent w-1/2"
              />
            </motion.div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
