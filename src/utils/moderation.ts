/**
 * Comprehensive Content Moderation Engine
 * 
 * Enforces strict moderation against:
 * - Every slur (racial, ethnic, homophobic, transphobic, religious, ableist)
 * - Every curse word / profanity (fuck, shit, bitch, ass, cunt, dick, etc.)
 * - Every sexual / NSFW term (porn, hentai, nsfw, sex, dildo, orgasm, nude, etc.)
 * 
 * EXCEPTION: "damn" and "hell" (and direct variations like dammit, damned, heck)
 * are explicitly permitted per user directive.
 */

export const ALLOWED_EXCEPTIONS = new Set([
  "damn",
  "dammit",
  "damned",
  "damnit",
  "hell",
  "heck",
  "hellish",
]);

// 1. Slurs (racial, ethnic, homophobic, transphobic, religious, ableist)
const SLUR_PATTERNS: RegExp[] = [
  // Racial / Ethnic
  /\b(?:n+[i1!l|]+g+g+[e3a4r]+s?|n+[i1!l|]+g+a+s?|n+[i1!l|]+g+g+[a4]+h?s?)\b/i,
  /\b(?:k+[i1!l|]+k+[e3]+s?)\b/i,
  /\b(?:c+h+[i1!l|]+n+k+s?)\b/i,
  /\b(?:s+p+[i1!l|]+c+s?|s+p+[i1!l|]+k+s?)\b/i,
  /\b(?:w+e+t+b+a+c+k+s?)\b/i,
  /\b(?:c+o+o+n+s?)\b/i,
  /\b(?:b+e+a+n+e+r+s?)\b/i,
  /\b(?:g+o+o+k+s?)\b/i,
  /\b(?:r+a+g+h+e+a+d+s?|t+o+w+e+l+h+e+a+d+s?)\b/i,
  /\b(?:k+a+f+f+[i1!l|]+r+s?)\b/i,
  /\b(?:p+a+k+[i1!l|]+s?)\b/i,
  /\b(?:j+a+p+s?)\b/i,
  /\b(?:c+h+[o0]+n+k+y?|c+h+[i1!l|]+n+g+\s*c+h+[o0]+n+g+)\b/i,
  // Homophobic / Transphobic
  /\b(?:f+a+g+g+[o0]+t+s?|f+a+g+s?)\b/i,
  /\b(?:d+y+k+[e3]+s?)\b/i,
  /\b(?:t+r+a+n+n+y|t+r+a+n+n+[i1!l|]+e+s?)\b/i,
  /\b(?:s+h+e+m+a+l+[e3]+s?)\b/i,
  // Ableist
  /\b(?:r+e+t+a+r+d+s?|r+e+t+a+r+d+[e3]+d+|r+e+t+a+r+d+a+t+[i1!l|]+[o0]+n+)\b/i,
  /\b(?:s+p+a+s+t+[i1!l|]+c+s?)\b/i,
];

// 2. Curse words / Profanities (EXCLUDING "damn" and "hell" which are allowed)
const CURSE_PATTERNS: RegExp[] = [
  /\b(?:f+u+c*k+(?:[e3]r|[i1!l|]+n+g?|[e3]d|s|o+f+f+|b+o+y+|h+e+a+d+)?|f+u+k+|f+u+q+|f+u+c+c+)\b/i,
  /\b(?:m+o+t+h+[e3]r+f+u+c*k+[e3]r+s?|m+o+t+h+[e3]r+f+u+c*k+[i1!l|]+n+g?)\b/i,
  /\b(?:s+h+[i1!l|]+t+s?|s+h+[i1!l|]+t+t+[e3]r+|s+h+[i1!l|]+t+t+y|b+u+l+l+s+h+[i1!l|]+t+|d+o+g+s+h+[i1!l|]+t+|h+o+r+s+e+s+h+[i1!l|]+t+|d+i+p+s+h+[i1!l|]+t+)\b/i,
  /\b(?:b+[i1!l|]+t+c+h+(?:[e3]s|[e3]d|y|[i1!l|]+n+g)?)\b/i,
  /\b(?:a+s+s+(?:h+[o0]+l+[e3]|w+[i1!l|]+p+[e3]|m+u+n+c+h+[e3]r|c+l+o+w+n|f+a+c+e)?s?)\b/i,
  /\b(?:j+a+c+k+a+s+s+|d+u+m+b+a+s+s+|f+a+t+a+s+s+|b+a+d+a+s+s+|s+m+a+r+t+a+s+s+)\b/i,
  /\b(?:b+a+s+t+a+r+d+s?)\b/i,
  /\b(?:c+u+n+t+s?)\b/i,
  /\b(?:t+w+a+t+s?)\b/i,
  /\b(?:p+u+s+s+y|p+u+s+s+[i1!l|]+e+s)\b/i,
  /\b(?:d+[i1!l|]+c+k+(?:h+e+a+d|s)?)\b/i,
  /\b(?:c+[o0]+c+k+(?:s+u+c+k+[e3]r|h+e+a+d)?s?)\b/i,
  /\b(?:p+r+[i1!l|]+c+k+s?)\b/i,
  /\b(?:w+a+n+k+[e3]r+s?|w+a+n+k+[i1!l|]+n+g?)\b/i,
  /\b(?:w+h+[o0]+r+[e3]+s?|s+l+u+t+s?)\b/i,
  /\b(?:k+y+s|k+m+s)\b/i,
  /\b(?:s+t+f+u|g+t+f+o)\b/i,
];

// 3. Sexual / NSFW terms
const SEXUAL_PATTERNS: RegExp[] = [
  /\b(?:p+[o0]+r+n+[o0]?|p+[o0]+r+n+[o0]+g+r+a+p+h+y|p+[o0]+r+n+h+u+b+)\b/i,
  /\b(?:n+s+f+w|x+x+x)\b/i,
  /\b(?:h+[e3]+n+t+a+[i1!l|]+)\b/i,
  /\b(?:s+[e3]+x+(?:y|u+a+l|u+a+l+l+y|[i1!l|]+n+g)?)\b/i,
  /\b(?:s+[e3]+x+t+[i1!l|]+n+g)\b/i,
  /\b(?:b+l+[o0]+w+j+[o0]+b+s?|h+a+n+d+j+[o0]+b+s?)\b/i,
  /\b(?:d+[i1!l|]+l+d+[o0]+s?|v+[i1!l|]+b+r+a+t+[o0]+r+s?)\b/i,
  /\b(?:m+a+s+t+u+r+b+a+t+[e3]+|m+a+s+t+u+r+b+a+t+[i1!l|]+[o0]+n+|j+e+r+k+[i1!l|]+n+g?\s+o+f+f+)\b/i,
  /\b(?:[o0]+r+g+a+s+m+s?|[o0]+r+g+a+s+m+[i1!l|]+c+)\b/i,
  /\b(?:c+u+m+(?:s|m+[i1!l|]+n+g|s+h+[o0]+t+s?)?)\b/i,
  /\b(?:j+[i1!l|]+z+z+|s+[e3]+m+[e3]+n+)\b/i,
  /\b(?:b+[o0]+[o0]+b+s?|b+[o0]+[o0]+b+[i1!l|]+e+s?)\b/i,
  /\b(?:t+[i1!l|]+t+s?|t+[i1!l|]+t+t+[i1!l|]+e+s?|t+[i1!l|]+t+t+y)\b/i,
  /\b(?:p+[e3]+n+[i1!l|]+s+e?s?)\b/i,
  /\b(?:v+a+g+[i1!l|]+n+a+s?)\b/i,
  /\b(?:c+l+[i1!l|]+t+[o0]+r+[i1!l|]+s+|c+l+[i1!l|]+t+s?)\b/i,
  /\b(?:s+c+r+[o0]+t+u+m+|t+[e3]+s+t+[i1!l|]+c+l+[e3]+s?)\b/i,
  /\b(?:a+n+a+l+(?:l+y)?)\b/i,
  /\b(?:d+[e3]+[e3]+p+t+h+r+[o0]+a+t+)\b/i,
  /\b(?:n+u+d+[e3]+s?|n+u+d+[i1!l|]+t+y|n+a+k+[e3]+d+)\b/i,
  /\b(?:s+t+r+[i1!l|]+p+p+[e3]+r+s?|s+t+r+[i1!l|]+p+t+[e3]+a+s+[e3]+)\b/i,
  /\b(?:b+d+s+m+|b+[o0]+n+d+a+g+[e3]+|f+[e3]+t+[i1!l|]+s+h+)\b/i,
  /\b(?:g+a+n+g+b+a+n+g+|b+u+k+k+a+k+[e3]+)\b/i,
  /\b(?:[e3]+r+[o0]+t+[i1!l|]+c+a?)\b/i,
  /\b(?:i+n+c+[e3]+s+t+)\b/i,
  /\b(?:c+a+m+g+[i1!l|]+r+l+|o+n+l+y+f+a+n+s+)\b/i,
];

// 4. Obfuscated / Evaded patterns (spaced letters, punctuation)
const OBFUSCATED_PATTERNS = [
  { regex: /f[\s._\-*~]+u[\s._\-*~]+c[\s._\-*~]+k/i, type: "curse word" },
  { regex: /s[\s._\-*~]+h[\s._\-*~]+i[\s._\-*~]+t/i, type: "curse word" },
  { regex: /b[\s._\-*~]+i[\s._\-*~]+t[\s._\-*~]+c[\s._\-*~]+h/i, type: "curse word" },
  { regex: /p[\s._\-*~]+o[\s._\-*~]+r[\s._\-*~]+n/i, type: "sexual term" },
  { regex: /n[\s._\-*~]+i[\s._\-*~]+g[\s._\-*~]+g/i, type: "slur" },
  { regex: /f[\s._\-*~]+a[\s._\-*~]+g/i, type: "slur" },
  { regex: /c[\s._\-*~]+u[\s._\-*~]+n[\s._\-*~]+t/i, type: "curse word" },
  { regex: /d[\s._\-*~]+i[\s._\-*~]+c[\s._\-*~]+k/i, type: "curse word" },
  { regex: /p[\s._\-*~]+u[\s._\-*~]+s[\s._\-*~]+s[\s._\-*~]+y/i, type: "curse word" },
  { regex: /s[\s._\-*~]+e[\s._\-*~]+x/i, type: "sexual term" },
  { regex: /n[\s._\-*~]+u[\s._\-*~]+d[\s._\-*~]+e/i, type: "sexual term" },
];

export interface ModerationResult {
  safe: boolean;
  reason?: string;
  category?: "slur" | "curse word" | "sexual term";
}

/**
 * Checks text against all slurs, curse words, and sexual terms.
 * Allows "damn" and "hell" as acceptable exceptions.
 */
export function checkTextModeration(input: string): ModerationResult {
  if (!input || typeof input !== "string") return { safe: true };

  const trimmed = input.trim();
  if (!trimmed) return { safe: true };

  // Normalize string for checks (handling common leetspeak substitutions)
  let norm = trimmed.toLowerCase();
  norm = norm.replace(/[@]/g, "a")
             .replace(/[$]/g, "s")
             .replace(/[0]/g, "o")
             .replace(/[1!|]/g, "i")
             .replace(/[3]/g, "e")
             .replace(/[5]/g, "s")
             .replace(/[7+]/g, "t");

  // 1. Check Obfuscated patterns first
  for (const item of OBFUSCATED_PATTERNS) {
    if (item.regex.test(trimmed) || item.regex.test(norm)) {
      return {
        safe: false,
        category: item.type as any,
        reason: `Prohibited ${item.type} detected. Chat moderation restricts slurs, curse words, and sexual terms (note: 'damn' and 'hell' are permitted).`
      };
    }
  }

  // 2. Check Slurs
  for (const pattern of SLUR_PATTERNS) {
    if (pattern.test(trimmed) || pattern.test(norm)) {
      return {
        safe: false,
        category: "slur",
        reason: "Hate speech, slurs, and discriminatory language are strictly prohibited."
      };
    }
  }

  // 3. Check Sexual terms
  for (const pattern of SEXUAL_PATTERNS) {
    if (pattern.test(trimmed) || pattern.test(norm)) {
      return {
        safe: false,
        category: "sexual term",
        reason: "Sexually explicit content, NSFW terms, and adult language are strictly prohibited."
      };
    }
  }

  // 4. Check Curse words (EXCEPT "damn" and "hell")
  for (const pattern of CURSE_PATTERNS) {
    const match = trimmed.match(pattern) || norm.match(pattern);
    if (match) {
      const matchedWord = match[0].toLowerCase();
      // Allow if it is damn or hell
      if (ALLOWED_EXCEPTIONS.has(matchedWord)) {
        continue;
      }
      return {
        safe: false,
        category: "curse word",
        reason: "Profanity and curse words are prohibited (note: 'damn' and 'hell' are permitted)."
      };
    }
  }

  return { safe: true };
}

/**
 * Validates a GIF search query to enforce PG guidelines.
 */
export function isQuerySafeForGif(query: string): { safe: boolean; reason?: string } {
  if (!query) return { safe: true };
  const res = checkTextModeration(query);
  if (!res.safe) {
    return {
      safe: false,
      reason: `PG Filter Active: Search query contains prohibited ${res.category || "language"}. Slurs, curse words, and sexual terms cannot be searched.`
    };
  }
  return { safe: true };
}
