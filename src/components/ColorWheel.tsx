import React, { useRef, useState, useCallback, useEffect } from "react";
import { ThemeRgb, rgbToHsv, hsvToRgb, rgbToHex } from "../utils/theme";

interface ColorWheelProps {
  color: ThemeRgb;
  onChange: (rgb: ThemeRgb) => void;
  size?: number;
}

export default function ColorWheel({ color, onChange, size = 240 }: ColorWheelProps) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // Convert current RGB to HSV
  const currentHsv = rgbToHsv(color.r, color.g, color.b);
  // Keep an active brightness state (between 0.05 and 1.0)
  const [brightness, setBrightness] = useState(() => Math.max(0.1, currentHsv.v));

  // Sync brightness if external color changes significantly
  useEffect(() => {
    const hsv = rgbToHsv(color.r, color.g, color.b);
    if (hsv.v > 0.05) {
      setBrightness(hsv.v);
    }
  }, [color.r, color.g, color.b]);

  /**
   * Conic Gradient color wheel mapping (matching reference image):
   * 0 deg (Top / 12 o'clock): Cyan (#00ffff, hue = 180)
   * 60 deg: Green (#00ff00, hue = 120)
   * 120 deg: Yellow (#ffff00, hue = 60)
   * 180 deg (Bottom / 6 o'clock): Red (#ff0000, hue = 0)
   * 240 deg: Magenta (#ff00ff, hue = 300)
   * 300 deg: Blue (#0000ff, hue = 240)
   * 360 deg: Cyan (#00ffff, hue = 180)
   *
   * Formula:
   * clockAngle in [0, 360) where 0 = Top, 90 = Right, 180 = Bottom, 270 = Left
   * hue = (180 - clockAngle + 360) % 360
   * clockAngle = (180 - hue + 360) % 360
   */
  const handlePointer = useCallback(
    (clientX: number, clientY: number) => {
      const el = wheelRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const radius = rect.width / 2;

      const dx = clientX - centerX;
      const dy = clientY - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Standard atan2 where top is -90 deg
      // Convert to clockAngle (0 at top, 90 at right, 180 at bottom, 270 at left)
      let clockAngle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      if (clockAngle < 0) clockAngle += 360;

      // Map clockAngle to Hue
      let hue = (180 - clockAngle + 360) % 360;

      // Saturation: 0 at center, 1 at edge
      const sat = Math.min(1, Math.max(0.05, dist / radius));

      const effectiveBrightness = Math.max(0.08, brightness);
      const newRgb = hsvToRgb(hue, sat, effectiveBrightness);
      onChange(newRgb);
    },
    [brightness, onChange]
  );

  const onMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    handlePointer(e.clientX, e.clientY);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    isDraggingRef.current = true;
    if (e.touches.length > 0) {
      handlePointer(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        handlePointer(e.clientX, e.clientY);
      }
    };
    const onMouseUp = () => {
      isDraggingRef.current = false;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (isDraggingRef.current && e.touches.length > 0) {
        handlePointer(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onTouchEnd = () => {
      isDraggingRef.current = false;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [handlePointer]);

  // Reticle position calculation
  const radius = size / 2;
  const clockAngle = (180 - currentHsv.h + 360) % 360;
  // Convert clock angle back to cartesian radians (0 at top means -90 deg from standard X axis)
  const rad = ((clockAngle - 90) * Math.PI) / 180;
  const effectiveSat = Math.max(0.05, Math.min(1, currentHsv.s));
  const reticleDist = effectiveSat * (radius - 8);

  const reticleX = radius + reticleDist * Math.cos(rad);
  const reticleY = radius + reticleDist * Math.sin(rad);

  const handleBrightnessChange = (newVal: number) => {
    const val = Math.max(0.05, Math.min(1, newVal));
    setBrightness(val);
    const newRgb = hsvToRgb(currentHsv.h, currentHsv.s, val);
    onChange(newRgb);
  };

  const currentColorHex = rgbToHex(color.r, color.g, color.b);

  return (
    <div className="flex flex-col items-center select-none w-full">
      {/* Outer Glow & Wheel Frame */}
      <div className="relative p-2.5 rounded-full bg-[#05060e] border border-white/20 shadow-2xl drop-shadow-[0_0_25px_rgba(0,0,0,0.8)]">
        {/* The Actual Color Wheel matching user's image exactly */}
        <div
          ref={wheelRef}
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
          style={{
            width: `${size}px`,
            height: `${size}px`,
            background: `conic-gradient(
              from 0deg at 50% 50%,
              hsl(180, 100%, 50%) 0deg,
              hsl(160, 100%, 50%) 20deg,
              hsl(140, 100%, 50%) 40deg,
              hsl(120, 100%, 50%) 60deg,
              hsl(90, 100%, 50%) 90deg,
              hsl(60, 100%, 50%) 120deg,
              hsl(35, 100%, 50%) 145deg,
              hsl(15, 100%, 50%) 165deg,
              hsl(0, 100%, 50%) 180deg,
              hsl(340, 100%, 50%) 200deg,
              hsl(315, 100%, 50%) 225deg,
              hsl(285, 100%, 50%) 255deg,
              hsl(260, 100%, 50%) 280deg,
              hsl(240, 100%, 50%) 300deg,
              hsl(215, 100%, 50%) 325deg,
              hsl(180, 100%, 50%) 360deg
            )`,
          }}
          className="relative rounded-full cursor-crosshair overflow-hidden touch-none shadow-inner transition-transform active:scale-[0.99]"
          title="Click or drag around the color wheel to select your hue and color"
        >
          {/* Subtle radial convergence layer towards center for smooth desaturation */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.05) 35%, rgba(0,0,0,0) 70%)",
            }}
          />

          {/* Central convergence point accent */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white/70 shadow-sm pointer-events-none" />

          {/* Interactive Reticle Target Cursor */}
          <div
            className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 transition-transform duration-75"
            style={{
              left: `${reticleX}px`,
              top: `${reticleY}px`,
            }}
          >
            {/* Outer white ring with dark drop shadow */}
            <div className="relative flex items-center justify-center w-7 h-7 rounded-full border-2 border-white bg-black/30 shadow-[0_0_8px_rgba(0,0,0,0.9)]">
              {/* Inner preview dot */}
              <div
                className="w-3.5 h-3.5 rounded-full border border-white/80 shadow-inner"
                style={{ backgroundColor: currentColorHex }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Compass Spectrum Labels */}
      <div className="flex items-center justify-between w-full max-w-[260px] px-2 pt-2 text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
        <span className="text-blue-400">Blue</span>
        <span className="text-cyan-400">Cyan</span>
        <span className="text-emerald-400">Green</span>
      </div>

      {/* Tone / Depth (Brightness) Slider */}
      <div className="w-full max-w-[270px] mt-2.5 space-y-1 bg-white/5 border border-white/10 p-2.5 rounded-xl">
        <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-200">
          <span>Theme Shade / Depth</span>
          <span className="font-mono text-xs text-white font-bold">
            {brightness < 0.25 ? "Deep Navy / Dark" : brightness < 0.65 ? "Medium" : "Vibrant"} ({Math.round(brightness * 100)}%)
          </span>
        </div>
        <div className="relative flex items-center">
          <input
            type="range"
            min={8}
            max={100}
            value={Math.round(brightness * 100)}
            onChange={(e) => handleBrightnessChange(Number(e.target.value) / 100)}
            className="w-full h-2 cursor-pointer appearance-none rounded-lg accent-white bg-gradient-to-r from-black via-indigo-900 to-indigo-400"
            title="Adjust between deep dark shades (great for backgrounds) and vibrant saturated tones"
          />
        </div>
        <div className="flex justify-between text-[9px] text-neutral-400 pt-0.5">
          <span>Dark Stealth (Navy tone)</span>
          <span>Full Vibrant</span>
        </div>
      </div>
    </div>
  );
}
