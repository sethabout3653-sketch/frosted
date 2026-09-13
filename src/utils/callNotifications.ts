// Browser System Notifications & In-App Alerts for Private Calls

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied";
  }
  if (Notification.permission === "granted") {
    return "granted";
  }
  try {
    const perm = await Notification.requestPermission();
    return perm;
  } catch (e) {
    return "denied";
  }
}

export function sendOffAppNotification({
  title,
  body,
  icon,
  tag = "frosted-call",
  onAnswer,
  onDecline,
  onClick,
}: {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  onAnswer?: () => void;
  onDecline?: () => void;
  onClick?: () => void;
}): Notification | null {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return null;
  }

  // Only trigger off-app notification if permission is granted
  if (Notification.permission !== "granted") {
    // Attempt permission request for subsequent calls
    Notification.requestPermission().catch(() => {});
    return null;
  }

  try {
    const notification = new Notification(title, {
      body,
      icon: icon || "/favicon.svg",
      tag,
      requireInteraction: true,
      silent: true, // We play our custom Web Audio ringtone
    } as any);

    notification.onclick = (event) => {
      event.preventDefault();
      try {
        window.focus();
      } catch (e) {}
      onClick?.();
      notification.close();
    };

    return notification;
  } catch (e) {
    console.warn("Failed to create off-app notification:", e);
    return null;
  }
}

export function isAppInForeground(): boolean {
  if (typeof document === "undefined") return true;
  return !document.hidden && document.hasFocus();
}
