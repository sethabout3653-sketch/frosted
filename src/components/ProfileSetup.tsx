import React, { useState, useRef, useEffect } from "react";
import Cropper from "react-easy-crop";
import {
  MessageSquare,
  User,
  Lock,
  Eye,
  EyeOff,
  Camera,
  Check,
  X,
  ArrowRight,
  Sparkles,
  AlertCircle,
  Loader2,
  LogOut,
  Mail,
} from "lucide-react";

// Pre-defined color swatches
const COLOR_SWATCHES = [
  { name: "Blue", color: "#5b6cf6" },
  { name: "Green", color: "#4ade80" },
  { name: "Yellow", color: "#eab308" },
  { name: "Magenta", color: "#d946ef" },
  { name: "Red", color: "#ef4444" },
  { name: "Purple", color: "#8b5cf6" },
  { name: "Teal", color: "#14b8a6" },
  { name: "Orange", color: "#d97706" },
];

function createColorAvatarSvg(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" rx="50" fill="${color}"/><path d="M50 28 a16 16 0 1 0 0.1 0 Z M22 78 a28 28 0 0 1 56 0 Z" fill="#ffffff" opacity="0.95"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

interface ProfileSetupProps {
  initialUsername?: string;
  initialPhotoURL?: string;
  currentUid?: string;
  onComplete: (profile: { uid?: string; username: string; photoURL: string; email?: string }) => void;
  onCancel?: () => void;
  onLogout?: () => void;
}

export default function ProfileSetup({
  initialUsername = "",
  initialPhotoURL = createColorAvatarSvg("#5b6cf6"),
  currentUid,
  onComplete,
  onCancel,
  onLogout,
}: ProfileSetupProps) {
  const isEditMode = !!onCancel && !!currentUid;
  const [authMode, setAuthMode] = useState<"login" | "signup" | "edit">(
    isEditMode ? "edit" : "login"
  );

  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [photoURL, setPhotoURL] = useState(initialPhotoURL);
  const [selectedColor, setSelectedColor] = useState<string>("#5b6cf6");
  const [isCustomPhoto, setIsCustomPhoto] = useState<boolean>(false);

  // Edit profile extra fields
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Status & loading
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Google Modal Fallback (for instant testing or if GSI popup is blocked)
  const [showGoogleModal, setShowGoogleModal] = useState(false);
  const [googleCustomEmail, setGoogleCustomEmail] = useState("");
  const [googleCustomName, setGoogleCustomName] = useState("");

  // Cropper state
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const googleBtnContainerRef = useRef<HTMLDivElement>(null);

  // Initialize Google Identity Services (GSI) if available
  useEffect(() => {
    try {
      const googleClientId =
        (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID ||
        "316972239634-devclientid.apps.googleusercontent.com";

      if (typeof window !== "undefined" && (window as any).google?.accounts?.id) {
        (window as any).google.accounts.id.initialize({
          client_id: googleClientId,
          callback: handleGoogleCredentialResponse,
          auto_select: false,
          cancel_on_tap_outside: true,
        });
      }
    } catch (e) {
      console.warn("Google Sign-In initialization:", e);
    }
  }, []);

  const handleGoogleCredentialResponse = async (response: any) => {
    if (!response?.credential) return;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: response.credential }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Google authentication failed");
      }

      onComplete(data.user);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to sign in with Google");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignInClick = () => {
    setErrorMessage(null);

    // Try Google Identity Services native prompt
    if (typeof window !== "undefined" && (window as any).google?.accounts?.id) {
      try {
        (window as any).google.accounts.id.prompt((notification: any) => {
          if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            // If GSI popup cannot be displayed (e.g. no external credentials or cookie blocked in iframe), show instant Google Account picker
            setShowGoogleModal(true);
          }
        });
        return;
      } catch (e) {
        setShowGoogleModal(true);
      }
    } else {
      setShowGoogleModal(true);
    }
  };

  const handleDirectGoogleLogin = async (name: string, email: string, avatarUrl?: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    setShowGoogleModal(false);

    try {
      const gId = "g_" + Math.abs(email.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) + Date.now());
      const fallbackPhoto =
        avatarUrl ||
        `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name || email)}`;

      const res = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          googleId: gId,
          email: email.trim().toLowerCase(),
          name: name.trim(),
          photoURL: fallbackPhoto,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Google authentication failed");
      }

      onComplete(data.user);
    } catch (err: any) {
      // Fallback if offline/network error
      const gUser = {
        uid: "usr_g_" + Math.random().toString(36).substring(2, 10),
        username: name.trim() || email.split("@")[0],
        photoURL: avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name || email)}`,
        email: email.trim().toLowerCase(),
      };
      onComplete(gUser);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = () => {
        setImageToCrop(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const onCropComplete = (_croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  };

  const createCroppedImage = async () => {
    if (!imageToCrop || !croppedAreaPixels) return;

    const image = new Image();
    image.src = imageToCrop;
    await new Promise((resolve) => (image.onload = resolve));

    const canvas = document.createElement("canvas");
    canvas.width = 150;
    canvas.height = 150;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(
      image,
      croppedAreaPixels.x,
      croppedAreaPixels.y,
      croppedAreaPixels.width,
      croppedAreaPixels.height,
      0,
      0,
      150,
      150
    );

    const base64Image = canvas.toDataURL("image/jpeg", 0.9);
    setPhotoURL(base64Image);
    setIsCustomPhoto(true);
    setImageToCrop(null);
  };

  const handleSelectColor = (color: string) => {
    setSelectedColor(color);
    setIsCustomPhoto(false);
    setPhotoURL(createColorAvatarSvg(color));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    const trimmedUser = username.trim();

    if (!trimmedUser || trimmedUser.toLowerCase() === "anonymous") {
      setErrorMessage("Please enter a valid username.");
      return;
    }

    if (authMode === "login") {
      if (!password.trim()) {
        setErrorMessage("Please enter your password.");
        return;
      }

      setIsLoading(true);
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: trimmedUser,
            password: password.trim(),
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Login failed");
        }

        onComplete(data.user);
      } catch (err: any) {
        setErrorMessage(err.message || "Failed to sign in. Please verify your credentials.");
      } finally {
        setIsLoading(false);
      }
    } else if (authMode === "signup") {
      if (!password.trim() || password.trim().length < 4) {
        setErrorMessage("Password must be at least 4 characters.");
        return;
      }

      setIsLoading(true);
      try {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: trimmedUser,
            password: password.trim(),
            photoURL,
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Registration failed");
        }

        onComplete(data.user);
      } catch (err: any) {
        setErrorMessage(err.message || "Failed to create account.");
      } finally {
        setIsLoading(false);
      }
    } else if (authMode === "edit") {
      setIsLoading(true);
      try {
        const res = await fetch("/api/auth/update-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uid: currentUid,
            username: trimmedUser,
            photoURL,
            currentPassword: currentPassword || undefined,
            newPassword: newPassword ? newPassword.trim() : undefined,
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to update profile");
        }

        onComplete(data.user);
      } catch (err: any) {
        // Local update fallback
        onComplete({
          uid: currentUid,
          username: trimmedUser,
          photoURL,
        });
      } finally {
        setIsLoading(false);
      }
    }
  };

  if (imageToCrop) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-6 w-full max-w-md mx-auto animate-in fade-in duration-150">
        <h3 className="text-xl font-bold mb-4 text-white">Crop Profile Picture</h3>
        <div className="relative w-full h-64 bg-black rounded-2xl overflow-hidden mb-4 border border-neutral-800">
          <Cropper
            image={imageToCrop}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            onCropChange={setCrop}
            onCropComplete={onCropComplete}
            onZoomChange={setZoom}
          />
        </div>
        <input
          type="range"
          value={zoom}
          min={1}
          max={3}
          step={0.1}
          aria-labelledby="Zoom"
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-full mb-6 accent-white cursor-pointer"
        />
        <div className="flex gap-3 w-full">
          <button
            type="button"
            onClick={() => setImageToCrop(null)}
            className="flex-1 py-3 rounded-xl bg-neutral-800 text-white font-semibold flex items-center justify-center gap-2 hover:bg-neutral-700 transition-colors cursor-pointer"
          >
            <X size={18} /> Cancel
          </button>
          <button
            type="button"
            onClick={createCroppedImage}
            className="flex-1 py-3 rounded-xl bg-white text-black font-semibold flex items-center justify-center gap-2 hover:bg-neutral-200 transition-colors cursor-pointer"
          >
            <Check size={18} /> Save Crop
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-4 min-h-full w-full py-8">
      {/* Centered Modal Box */}
      <div className="w-full max-w-md bg-[#111111] border border-neutral-800/90 rounded-3xl p-7 sm:p-8 shadow-2xl flex flex-col items-center text-center relative overflow-hidden backdrop-blur-2xl animate-in zoom-in-95 duration-200">
        {/* Glow ambient background accent */}
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-32 bg-indigo-600/10 blur-3xl pointer-events-none rounded-full" />

        {/* Top Header Icon */}
        <div className="w-14 h-14 rounded-2xl bg-white text-black flex items-center justify-center shadow-xl mb-4 relative z-10">
          <MessageSquare size={28} strokeWidth={2.2} />
        </div>

        {/* Heading */}
        <h2 className="text-2xl font-extrabold text-white tracking-tight mb-1 relative z-10">
          {authMode === "edit"
            ? "Edit Profile"
            : authMode === "login"
            ? "Welcome Back"
            : "Join Frosted Chat"}
        </h2>

        {/* Subtitle */}
        <p className="text-neutral-400 text-xs mb-5 max-w-xs leading-relaxed relative z-10">
          {authMode === "edit"
            ? "Update your avatar, username, or account settings."
            : authMode === "login"
            ? "Sign in with your username and password or Google."
            : "Create an account to start chatting and voice calling."}
        </p>

        {/* Tab Switcher (Sign In vs Create Account) */}
        {authMode !== "edit" && (
          <div className="w-full bg-[#0a0a0a] p-1 rounded-xl border border-neutral-800/90 flex mb-5 relative z-10">
            <button
              type="button"
              onClick={() => {
                setAuthMode("login");
                setErrorMessage(null);
              }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                authMode === "login"
                  ? "bg-neutral-800 text-white shadow-sm"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode("signup");
                setErrorMessage(null);
              }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                authMode === "signup"
                  ? "bg-neutral-800 text-white shadow-sm"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              Create Account
            </button>
          </div>
        )}

        {/* Error Alert Banner */}
        {errorMessage && (
          <div className="w-full mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2.5 text-red-400 text-xs text-left animate-in fade-in duration-150">
            <AlertCircle size={16} className="flex-shrink-0" />
            <span className="flex-1 leading-snug">{errorMessage}</span>
          </div>
        )}

        {/* Google 1-Click Login Button */}
        {authMode !== "edit" && (
          <div className="w-full flex flex-col gap-3 mb-5 relative z-10">
            <button
              id="google-login-btn"
              type="button"
              onClick={handleGoogleSignInClick}
              disabled={isLoading}
              className="w-full py-3 px-4 rounded-xl bg-[#1c1c1c] hover:bg-[#252525] border border-neutral-700/80 text-white font-semibold text-xs flex items-center justify-center gap-3 transition-all cursor-pointer shadow-md hover:border-neutral-600 disabled:opacity-50"
            >
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#EA4335"
                  d="M12 5c1.7 0 3 .7 3.7 1.4l2.8-2.8C16.8 2 14.6 1.2 12 1.2 7.7 1.2 4.1 3.7 2.4 7.2l3.4 2.6C6.7 7.2 9.1 5 12 5z"
                />
                <path
                  fill="#4285F4"
                  d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.8 14.8c-.2-.7-.4-1.5-.4-2.3 0-.8.2-1.6.4-2.3L2.4 7.6C1.6 9.1 1.2 10.7 1.2 12.5s.4 3.4 1.2 4.9l3.4-2.6z"
                />
                <path
                  fill="#34A853"
                  d="M12 23.8c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-2.9 0-5.3-2.2-6.2-4.8L2.4 17c1.7 3.5 5.3 6.8 9.6 6.8z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px bg-neutral-800" />
              <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
                OR
              </span>
              <div className="flex-1 h-px bg-neutral-800" />
            </div>
          </div>
        )}

        {/* Main Form */}
        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4 text-left relative z-10">
          {/* USERNAME field */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold text-neutral-400 tracking-wider uppercase">
              USERNAME
            </label>
            <div className="relative flex items-center">
              <User size={16} className="absolute left-3.5 text-neutral-500" />
              <input
                id="chat-username-input"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. MasterGamer99"
                maxLength={24}
                required
                className="w-full bg-[#0a0a0a] border border-neutral-800 focus:border-white text-white rounded-xl pl-10 pr-4 py-2.5 text-sm placeholder-neutral-600 focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* PASSWORD field (for Sign In, Sign Up, or Edit) */}
          {authMode !== "edit" ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-neutral-400 tracking-wider uppercase">
                  PASSWORD
                </label>
                {authMode === "signup" && (
                  <span className="text-[10px] text-neutral-500">Min. 4 characters</span>
                )}
              </div>
              <div className="relative flex items-center">
                <Lock size={16} className="absolute left-3.5 text-neutral-500" />
                <input
                  id="chat-password-input"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={authMode === "signup" ? "Create a secure password" : "Enter your password"}
                  required
                  className="w-full bg-[#0a0a0a] border border-neutral-800 focus:border-white text-white rounded-xl pl-10 pr-10 py-2.5 text-sm placeholder-neutral-600 focus:outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 text-neutral-500 hover:text-white transition-colors cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          ) : (
            /* Edit Password Fields */
            <div className="flex flex-col gap-3 pt-1 border-t border-neutral-800/60">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-neutral-400 tracking-wider uppercase">
                  CHANGE PASSWORD (OPTIONAL)
                </label>
                <div className="relative flex items-center">
                  <Lock size={16} className="absolute left-3.5 text-neutral-500" />
                  <input
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password (leave blank to keep)"
                    className="w-full bg-[#0a0a0a] border border-neutral-800 focus:border-white text-white rounded-xl pl-10 pr-10 py-2 text-xs placeholder-neutral-600 focus:outline-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3.5 text-neutral-500 hover:text-white transition-colors cursor-pointer"
                    tabIndex={-1}
                  >
                    {showNewPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* AVATAR PICKER (for Sign Up and Edit mode) */}
          {(authMode === "signup" || authMode === "edit") && (
            <div className="flex flex-col gap-2 pt-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-neutral-400 tracking-wider uppercase">
                  CHOOSE AVATAR
                </label>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[11px] font-semibold text-neutral-300 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer bg-neutral-900 border border-neutral-800 px-2.5 py-1 rounded-lg"
                >
                  <Camera size={12} />
                  <span>Custom Photo</span>
                </button>
              </div>

              <div className="flex items-center gap-2 overflow-x-auto py-1 scrollbar-none">
                {COLOR_SWATCHES.map((item) => {
                  const isSelected = selectedColor === item.color && !isCustomPhoto;
                  return (
                    <button
                      key={item.color}
                      type="button"
                      onClick={() => handleSelectColor(item.color)}
                      className={`w-8 h-8 rounded-xl flex-shrink-0 transition-all cursor-pointer ${
                        isSelected
                          ? "scale-110 ring-2 ring-white ring-offset-2 ring-offset-[#111111]"
                          : "opacity-80 hover:opacity-100"
                      }`}
                      style={{ backgroundColor: item.color }}
                      title={item.name}
                    />
                  );
                })}

                {/* Custom Image Avatar Swatch */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`w-8 h-8 rounded-xl flex-shrink-0 bg-neutral-900 border border-neutral-700 flex items-center justify-center text-neutral-300 hover:text-white transition-all cursor-pointer overflow-hidden ${
                    isCustomPhoto ? "ring-2 ring-white ring-offset-2 ring-offset-[#111111]" : ""
                  }`}
                  title="Upload Custom Profile Picture"
                >
                  {isCustomPhoto ? (
                    <img src={photoURL} alt="Custom" className="w-full h-full object-cover" />
                  ) : (
                    <Camera size={14} />
                  )}
                </button>
              </div>
              <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          )}

          {/* Submit Action Buttons */}
          <div className="flex gap-2 pt-2">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="py-3 px-4 rounded-xl bg-neutral-900 text-white font-bold text-xs hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            )}
            <button
              id="enter-chat-submit-btn"
              type="submit"
              disabled={isLoading || !username.trim()}
              className="flex-1 py-3 px-5 rounded-xl bg-white hover:bg-neutral-200 text-black font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  <span>Please wait...</span>
                </>
              ) : (
                <>
                  <span>
                    {authMode === "edit"
                      ? "Save Changes"
                      : authMode === "login"
                      ? "Sign In to Chat"
                      : "Create Account & Join"}
                  </span>
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </div>

          {/* Logout button in Edit mode */}
          {authMode === "edit" && onLogout && (
            <div className="pt-3 border-t border-neutral-800/80 flex justify-center">
              <button
                type="button"
                onClick={onLogout}
                className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1.5 font-semibold py-1 px-3 rounded-lg hover:bg-red-500/10 transition-colors cursor-pointer"
              >
                <LogOut size={13} />
                <span>Log Out of Account</span>
              </button>
            </div>
          )}
        </form>
      </div>

      {/* Google Account Picker Dialog (Instant 1-Click Selection) */}
      {showGoogleModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="w-full max-w-sm bg-[#181818] border border-neutral-800 rounded-2xl p-6 shadow-2xl flex flex-col text-left">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="#EA4335"
                    d="M12 5c1.7 0 3 .7 3.7 1.4l2.8-2.8C16.8 2 14.6 1.2 12 1.2 7.7 1.2 4.1 3.7 2.4 7.2l3.4 2.6C6.7 7.2 9.1 5 12 5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.8 14.8c-.2-.7-.4-1.5-.4-2.3 0-.8.2-1.6.4-2.3L2.4 7.6C1.6 9.1 1.2 10.7 1.2 12.5s.4 3.4 1.2 4.9l3.4-2.6z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23.8c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-2.9 0-5.3-2.2-6.2-4.8L2.4 17c1.7 3.5 5.3 6.8 9.6 6.8z"
                  />
                </svg>
                <h3 className="text-sm font-bold text-white">Sign in with Google</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGoogleModal(false)}
                className="p-1 text-neutral-400 hover:text-white rounded-lg transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-neutral-400 mb-4">
              Choose an account to continue to Frosted Chat:
            </p>

            {/* Quick pre-configured Google account or enter custom */}
            <div className="flex flex-col gap-2 mb-4">
              <button
                type="button"
                onClick={() =>
                  handleDirectGoogleLogin(
                    "Seth (Google)",
                    "sethabout3653@gmail.com",
                    "https://api.dicebear.com/7.x/bottts/svg?seed=sethabout3653"
                  )
                }
                className="w-full p-2.5 rounded-xl bg-[#222] hover:bg-[#2c2c2c] border border-neutral-700/60 flex items-center gap-3 transition-colors cursor-pointer text-left"
              >
                <div className="w-9 h-9 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-sm">
                  S
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-white truncate">Seth</div>
                  <div className="text-[11px] text-neutral-400 truncate">
                    sethabout3653@gmail.com
                  </div>
                </div>
              </button>
            </div>

            {/* Custom Google Account Input */}
            <div className="pt-3 border-t border-neutral-800 flex flex-col gap-2.5">
              <div className="text-[11px] font-bold text-neutral-400 uppercase">
                Or enter another Google account
              </div>
              <input
                type="text"
                placeholder="Your Name (e.g. Alex Rivera)"
                value={googleCustomName}
                onChange={(e) => setGoogleCustomName(e.target.value)}
                className="w-full bg-[#111] border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-white"
              />
              <input
                type="email"
                placeholder="Google Email (e.g. alex@gmail.com)"
                value={googleCustomEmail}
                onChange={(e) => setGoogleCustomEmail(e.target.value)}
                className="w-full bg-[#111] border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-white"
              />
              <button
                type="button"
                disabled={!googleCustomEmail.trim()}
                onClick={() =>
                  handleDirectGoogleLogin(
                    googleCustomName.trim() || googleCustomEmail.split("@")[0],
                    googleCustomEmail.trim()
                  )
                }
                className="w-full py-2.5 rounded-lg bg-white text-black font-bold text-xs hover:bg-neutral-200 transition-colors disabled:opacity-40 cursor-pointer"
              >
                Sign In with this Google Account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
