import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Snowflake, Sparkles } from "lucide-react";

interface LoadingScreenProps {
  onComplete: () => void;
}

export default function LoadingScreen({ onComplete }: LoadingScreenProps) {
  const [progress, setProgress] = useState(12);

  useEffect(() => {
    // Fill up the energy conduit smoothly across the 1.5s duration
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(progressInterval);
          return 100;
        }
        return Math.min(100, prev + 7);
      });
    }, 90);

    // After exactly 1.5 seconds, transition out and complete
    const completeTimer = setTimeout(() => {
      setProgress(100);
      onComplete();
    }, 1500);

    return () => {
      clearInterval(progressInterval);
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
        scale: 1.08,
        filter: "blur(12px)",
        transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
      }}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden bg-[#020410] select-none text-white cursor-wait"
      style={{ pointerEvents: "auto" }}
    >
      {/* Background Cosmic Starfield & Radial Glows */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at center, var(--theme-accent) 0%, var(--theme-surface) 45%, var(--theme-darkest) 85%)"
        }}
      />

      {/* Dynamic Cosmic Energy Pulse */}
      <motion.div
        animate={{
          scale: [1, 1.25, 1],
          opacity: [0.35, 0.6, 0.35],
        }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        className="absolute w-[520px] h-[520px] rounded-full bg-gradient-to-tr from-[var(--theme-indigo-600)]/35 via-[var(--theme-indigo-500)]/25 to-cyan-400/30 blur-3xl pointer-events-none"
      />

      {/* Background Micro Stars */}
      <div className="absolute inset-0 opacity-40 pointer-events-none">
        <div className="absolute top-[20%] left-[25%] w-1.5 h-1.5 rounded-full bg-cyan-300 animate-ping duration-1000" />
        <div className="absolute top-[32%] right-[22%] w-1 h-1 rounded-full bg-[var(--theme-indigo-200)] animate-pulse" />
        <div className="absolute bottom-[28%] left-[28%] w-1 h-1 rounded-full bg-white/70 animate-pulse" />
        <div className="absolute bottom-[36%] right-[24%] w-1.5 h-1.5 rounded-full bg-cyan-200 animate-ping duration-1000" />
      </div>

      {/* Central Holographic Emblem Stage */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Multi-Ring Orbital Reactor */}
        <div className="relative w-36 h-36 sm:w-44 sm:h-44 flex items-center justify-center mb-6">
          {/* Outer Dashed Rotating Ring (Clockwise) */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
            className="absolute inset-0 rounded-full border border-dashed border-cyan-400/60 shadow-[0_0_25px_rgba(56,189,248,0.4)]"
          />

          {/* Secondary Counter Ring (Counter-Clockwise) */}
          <motion.div
            animate={{ rotate: -360 }}
            transition={{ duration: 7, repeat: Infinity, ease: "linear" }}
            className="absolute inset-2 rounded-full border-2 border-transparent border-t-[var(--theme-indigo-400)] border-b-cyan-300 shadow-[0_0_20px_var(--theme-glow)]"
          />

          {/* Inner Ambient Ring */}
          <motion.div
            animate={{ scale: [0.95, 1.05, 0.95] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            className="absolute inset-5 rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)]/60 backdrop-blur-md shadow-inner"
          />

          {/* Central Frosted Core Emblem */}
          <motion.div
            animate={{
              scale: [0.96, 1.05, 0.96],
              rotate: [0, 4, -4, 0],
            }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            className="relative z-10 w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-gradient-to-br from-[var(--theme-accent-hover)] via-[var(--theme-accent)] to-[var(--theme-darkest)] border-2 border-[var(--theme-border-strong)] shadow-[0_0_35px_var(--theme-glow)] flex items-center justify-center"
          >
            <Snowflake
              size={40}
              className="text-cyan-300 drop-shadow-[0_0_14px_rgba(103,232,249,0.9)] animate-pulse"
              strokeWidth={1.8}
            />
            <Sparkles
              size={15}
              className="absolute -top-1.5 -right-1.5 text-[var(--theme-indigo-300)] animate-bounce"
            />
          </motion.div>
        </div>

        {/* Wordmark "FROSTED STUDYING" */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="text-center flex flex-col items-center"
        >
          <div className="relative inline-block">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-[0.22em] uppercase text-transparent bg-clip-text bg-gradient-to-r from-cyan-200 via-white to-[var(--theme-indigo-300)] drop-shadow-[0_0_25px_var(--theme-glow)] whitespace-nowrap">
              FROSTED STUDYING
            </h1>
          </div>

          <p className="mt-2 text-[10px] sm:text-xs font-bold tracking-[0.35em] uppercase text-[var(--theme-text-muted)] flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
            UNBLOCKED PORTAL • STUDY HUB
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--theme-indigo-400)]" />
          </p>
        </motion.div>

        {/* Energy Conduit Progress Meter */}
        <div className="mt-6 w-56 sm:w-64 flex flex-col items-center gap-2">
          <div className="relative w-full h-1.5 rounded-full bg-[var(--theme-darkest)] border border-[var(--theme-border-subtle)] p-0.5 overflow-hidden shadow-inner shadow-black">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-[var(--theme-indigo-500)] via-cyan-400 to-white shadow-[0_0_12px_var(--theme-glow)]"
              style={{ width: `${progress}%` }}
              transition={{ ease: "easeOut" }}
            />
          </div>
          <span className="text-[10px] font-mono text-cyan-300/90 tracking-widest uppercase">
            CONNECTING • {progress}%
          </span>
        </div>
      </div>
    </motion.div>
  );
}
