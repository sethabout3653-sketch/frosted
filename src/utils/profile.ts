import { ChatProfile } from "../types";

export function getOrCreateChatProfile(): ChatProfile {
  const existing = getSavedChatProfile();
  if (existing) return existing;

  const randomNum = Math.floor(1000 + Math.random() * 9000);
  const guestName = `Guest_${randomNum}`;
  const guestUid = `user_guest_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const guestProfile: ChatProfile = {
    uid: guestUid,
    username: guestName,
    photoURL: `https://api.dicebear.com/7.x/bottts/svg?seed=${guestUid}`,
  };

  saveChatProfile(guestProfile);
  return guestProfile;
}

export function getSavedChatProfile(): ChatProfile | null {
  try {
    if (typeof window === "undefined") return null;

    const params = new URLSearchParams(window.location.search);
    const urlUser = params.get("user");
    if (urlUser && urlUser.trim().toLowerCase() !== "anonymous") {
      return {
        uid: "user_" + urlUser.toLowerCase().replace(/[^a-z0-9]/g, ""),
        username: urlUser.trim(),
        photoURL: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(urlUser.trim())}`,
      };
    }

    const sessionSaved = sessionStorage.getItem("frosted_chat_profile");
    if (sessionSaved) {
      const parsed = JSON.parse(sessionSaved);
      if (parsed && parsed.username && parsed.username.trim().toLowerCase() !== "anonymous") {
        return parsed;
      }
    }

    const saved = localStorage.getItem("frosted_chat_profile");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.username && parsed.username.trim().toLowerCase() !== "anonymous") {
        return parsed;
      }
    }
  } catch (e) {}
  return null;
}

export function saveChatProfile(profile: ChatProfile) {
  try {
    localStorage.setItem("frosted_chat_profile", JSON.stringify(profile));
    sessionStorage.setItem("frosted_chat_profile", JSON.stringify(profile));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("frosted_profile_updated", { detail: profile }));
    }
  } catch (e) {}
}

export function subscribeProfileUpdates(callback: (profile: ChatProfile | null) => void) {
  if (typeof window === "undefined") return () => {};

  const handleCustom = (e: any) => {
    callback(e.detail || getSavedChatProfile());
  };

  const handleStorage = (e: StorageEvent) => {
    if (e.key === "frosted_chat_profile") {
      callback(getSavedChatProfile());
    }
  };

  window.addEventListener("frosted_profile_updated", handleCustom);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener("frosted_profile_updated", handleCustom);
    window.removeEventListener("storage", handleStorage);
  };
}

