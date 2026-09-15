import { useEffect, useRef, useState, useCallback } from "react";
import { UserActivity, ChatProfile } from "../types";
import { wsClient } from "./websocket-client";
import { db, doc, setDoc, toTimestampMs } from "../supabase-adapter";

// Persistent or Session Profile Retriever
export function getSavedProfile(): ChatProfile | null {
  try {
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

// Global in-memory current user activity state
let currentGlobalActivity: UserActivity = {
  type: "scrolling",
  text: "Browsing games",
  startedAt: Date.now(),
  timestamp: Date.now(),
};

const activityListeners = new Set<(activity: UserActivity) => void>();

export function updateGlobalActivity(activity: Partial<UserActivity>) {
  const now = Date.now();
  const prev = currentGlobalActivity;

  let computedText = activity.text;
  if (!computedText) {
    if (activity.type === "playing") {
      computedText = `Playing ${activity.gameName || "Game"}`;
    } else if (activity.type === "searching") {
      computedText = activity.query ? `Searching: "${activity.query}"` : "Searching for games";
    } else if (activity.type === "chatting") {
      computedText = activity.channel ? `In Chat #${activity.channel}` : "In Frosted Chat";
    } else if (activity.type === "scrolling") {
      computedText = activity.tag && activity.tag !== "all" ? `Browsing ${activity.tag}` : "Scrolling games";
    } else {
      computedText = "Browsing games";
    }
  }

  const isSameTypeAndTarget =
    prev.type === activity.type &&
    prev.gameName === activity.gameName &&
    prev.query === activity.query &&
    prev.tag === activity.tag &&
    prev.channel === activity.channel;

  const nextActivity: UserActivity = {
    ...prev,
    ...activity,
    text: computedText,
    startedAt: isSameTypeAndTarget ? prev.startedAt || now : now,
    timestamp: now,
  };

  currentGlobalActivity = nextActivity;
  activityListeners.forEach((cb) => {
    try {
      cb(nextActivity);
    } catch (e) {}
  });

  // Broadcast instantly via WebSockets and save to persistent presence
  broadcastPresenceUpdate(nextActivity);
}

export function getCurrentActivity(): UserActivity {
  return currentGlobalActivity;
}

export function onActivityChanged(cb: (act: UserActivity) => void): () => void {
  activityListeners.add(cb);
  cb(currentGlobalActivity);
  return () => {
    activityListeners.delete(cb);
  };
}

let lastBroadcastTs = 0;
let pendingBroadcastTimer: any = null;

export function broadcastPresenceUpdate(activity?: UserActivity) {
  const profile = getSavedProfile();
  if (!profile || !profile.uid) return;

  const active = activity || currentGlobalActivity;
  const now = Date.now();

  const presencePayload = {
    uid: profile.uid,
    username: profile.username,
    photoURL: profile.photoURL || "",
    status: "online",
    lastSeen: now,
    timestamp: now,
    activity: active,
  };

  // 1. Instant 0ms WebSocket Broadcast
  try {
    wsClient.setUserUid(profile.uid);
    wsClient.sendChange("set", "presence", profile.uid, presencePayload);
  } catch (e) {}

  // 2. Throttle persistent database writes to avoid hammering
  if (now - lastBroadcastTs > 1500) {
    lastBroadcastTs = now;
    if (pendingBroadcastTimer) clearTimeout(pendingBroadcastTimer);
    try {
      setDoc(doc(db, "presence", profile.uid), presencePayload, { merge: true }).catch(() => {});
    } catch (e) {}
  } else if (!pendingBroadcastTimer) {
    pendingBroadcastTimer = setTimeout(() => {
      pendingBroadcastTimer = null;
      lastBroadcastTs = Date.now();
      try {
        setDoc(doc(db, "presence", profile.uid), {
          ...presencePayload,
          lastSeen: Date.now(),
          timestamp: Date.now(),
        }, { merge: true }).catch(() => {});
      } catch (e) {}
    }, 1500);
  }
}

/**
 * React Hook to synchronize view, search query, selected game, and scroll events to real-time activity
 */
export function useActivityTracker({
  currentView,
  selectedGame,
  searchQuery,
  selectedTag,
  activeChannel,
}: {
  currentView: "home" | "game" | "chat";
  selectedGame?: { name: string; cover?: string } | null;
  searchQuery?: string;
  selectedTag?: string;
  activeChannel?: string;
}) {
  const lastScrollTimeRef = useRef(0);

  // Sync state changes to global activity
  useEffect(() => {
    if (currentView === "game" && selectedGame) {
      updateGlobalActivity({
        type: "playing",
        gameName: selectedGame.name,
        gameCover: selectedGame.cover,
        text: `Playing ${selectedGame.name}`,
      });
      return;
    }

    if (currentView === "chat") {
      updateGlobalActivity({
        type: "chatting",
        channel: activeChannel || "general",
        text: activeChannel ? `In #${activeChannel}` : "In Frosted Chat",
      });
      return;
    }

    // Home view
    if (searchQuery && searchQuery.trim().length > 0) {
      updateGlobalActivity({
        type: "searching",
        query: searchQuery.trim(),
        text: `Searching: "${searchQuery.trim()}"`,
      });
      return;
    }

    // Scrolling / Browsing games catalog
    updateGlobalActivity({
      type: "scrolling",
      tag: selectedTag || "all",
      text: selectedTag && selectedTag !== "all" ? `Browsing ${selectedTag}` : "Browsing games",
    });
  }, [currentView, selectedGame?.name, searchQuery, selectedTag, activeChannel]);

  // Track window scroll when on home view
  useEffect(() => {
    if (currentView !== "home") return;

    const handleScroll = () => {
      const now = Date.now();
      if (now - lastScrollTimeRef.current > 2000) {
        lastScrollTimeRef.current = now;
        if (!searchQuery?.trim()) {
          updateGlobalActivity({
            type: "scrolling",
            tag: selectedTag || "all",
            text: selectedTag && selectedTag !== "all" ? `Browsing ${selectedTag}` : "Scrolling games",
          });
        }
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [currentView, searchQuery, selectedTag]);

  // Periodic heartbeat every 3 seconds to keep WebSocket presence and lastSeen active
  useEffect(() => {
    const heartbeat = setInterval(() => {
      broadcastPresenceUpdate();
    }, 3000);

    return () => clearInterval(heartbeat);
  }, []);
}
