// Utility to extract dominant base color and palette from profile picture
const colorCache = new Map<string, {
  hex: string;
  rgb: [number, number, number];
  glow: string;
  border: string;
  ring: string;
}>();

// Deterministic fallback palette for usernames
const PALETTE = [
  "#5865F2", // Discord Blurple
  "#57F287", // Green
  "#FEE75C", // Yellow
  "#EB459E", // Fuchsia
  "#ED4245", // Red
  "#00A8FC", // Cyan / Blue
  "#9B59B6", // Purple
  "#E67E22", // Orange
  "#1ABC9C", // Teal
  "#E91E63", // Pink
];

export function getFallbackColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color = PALETTE[Math.abs(hash) % PALETTE.length];
  return color;
}

export function parseHexToRgb(hex: string): [number, number, number] {
  let c = hex.replace("#", "");
  if (c.length === 3) {
    c = c.split("").map((x) => x + x).join("");
  }
  const num = parseInt(c, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export async function extractDominantColor(
  imageUrl?: string | null,
  fallbackName: string = "User"
): Promise<{
  hex: string;
  rgb: [number, number, number];
  glow: string;
  border: string;
  ring: string;
}> {
  if (!imageUrl) {
    const hex = getFallbackColor(fallbackName);
    const rgb = parseHexToRgb(hex);
    return {
      hex,
      rgb,
      glow: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.45)`,
      border: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.85)`,
      ring: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.35)`,
    };
  }

  if (colorCache.has(imageUrl)) {
    return colorCache.get(imageUrl)!;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = imageUrl;

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Canvas context not available");

        const sampleSize = 40;
        canvas.width = sampleSize;
        canvas.height = sampleSize;
        ctx.drawImage(img, 0, 0, sampleSize, sampleSize);

        const imgData = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
        let rTotal = 0;
        let gTotal = 0;
        let bTotal = 0;
        let count = 0;

        // Color bucket weighting to pick the most vibrant / distinct base color
        const colorBuckets: { [key: string]: { r: number; g: number; b: number; count: number; score: number } } = {};

        for (let i = 0; i < imgData.length; i += 4) {
          const a = imgData[i + 3];
          if (a < 128) continue; // Skip transparent pixels

          const r = imgData[i];
          const g = imgData[i + 1];
          const b = imgData[i + 2];

          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
          const saturation = max === 0 ? 0 : (max - min) / max;

          // Skip near pure blacks (< 15) and pure blown-out whites (> 245)
          if (brightness < 18 || brightness > 245) continue;

          // Bucket by coarse 32-value quantization
          const bucketKey = `${Math.floor(r / 32)}_${Math.floor(g / 32)}_${Math.floor(b / 32)}`;
          if (!colorBuckets[bucketKey]) {
            colorBuckets[bucketKey] = { r: 0, g: 0, b: 0, count: 0, score: 0 };
          }

          // Give extra score weight to saturated / colorful pixels
          const vibrancyBoost = 1 + saturation * 2.5;
          colorBuckets[bucketKey].r += r;
          colorBuckets[bucketKey].g += g;
          colorBuckets[bucketKey].b += b;
          colorBuckets[bucketKey].count += 1;
          colorBuckets[bucketKey].score += vibrancyBoost;

          rTotal += r;
          gTotal += g;
          bTotal += b;
          count++;
        }

        let bestBucket = null;
        let highestScore = -1;
        for (const bucket of Object.values(colorBuckets)) {
          if (bucket.score > highestScore) {
            highestScore = bucket.score;
            bestBucket = bucket;
          }
        }

        let finalR = 88;
        let finalG = 101;
        let finalB = 242;

        if (bestBucket && bestBucket.count > 0) {
          finalR = Math.round(bestBucket.r / bestBucket.count);
          finalG = Math.round(bestBucket.g / bestBucket.count);
          finalB = Math.round(bestBucket.b / bestBucket.count);
        } else if (count > 0) {
          finalR = Math.round(rTotal / count);
          finalG = Math.round(gTotal / count);
          finalB = Math.round(bTotal / count);
        }

        // Boost saturation slightly if it's too washed out so the speaking glow looks vibrant
        const max = Math.max(finalR, finalG, finalB);
        const min = Math.min(finalR, finalG, finalB);
        if (max - min < 25 && max > 30) {
          // If greyish, fallback to cheerful accent
          const fallbackHex = getFallbackColor(fallbackName);
          const fallbackRgb = parseHexToRgb(fallbackHex);
          finalR = fallbackRgb[0];
          finalG = fallbackRgb[1];
          finalB = fallbackRgb[2];
        }

        const hex = `#${((1 << 24) + (finalR << 16) + (finalG << 8) + finalB).toString(16).slice(1)}`;
        const result = {
          hex,
          rgb: [finalR, finalG, finalB] as [number, number, number],
          glow: `rgba(${finalR}, ${finalG}, ${finalB}, 0.55)`,
          border: `rgba(${finalR}, ${finalG}, ${finalB}, 0.85)`,
          ring: `rgba(${finalR}, ${finalG}, ${finalB}, 0.35)`,
        };

        colorCache.set(imageUrl, result);
        resolve(result);
      } catch {
        const hex = getFallbackColor(fallbackName);
        const rgb = parseHexToRgb(hex);
        const fallback = {
          hex,
          rgb,
          glow: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.45)`,
          border: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.85)`,
          ring: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.35)`,
        };
        colorCache.set(imageUrl, fallback);
        resolve(fallback);
      }
    };

    img.onerror = () => {
      const hex = getFallbackColor(fallbackName);
      const rgb = parseHexToRgb(hex);
      const fallback = {
        hex,
        rgb,
        glow: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.45)`,
        border: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.85)`,
        ring: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.35)`,
      };
      colorCache.set(imageUrl, fallback);
      resolve(fallback);
    };
  });
}
