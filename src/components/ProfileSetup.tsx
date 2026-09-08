import React, { useState, useRef } from "react";
import Cropper from "react-easy-crop";
import { MessageSquare, User, Camera, Check, X, ArrowRight } from "lucide-react";

// Pre-defined color swatches matching Image 3
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
  onComplete: (profile: { username: string; photoURL: string }) => void;
  onCancel?: () => void;
}

export default function ProfileSetup({
  initialUsername = "",
  initialPhotoURL = createColorAvatarSvg("#5b6cf6"),
  onComplete,
  onCancel,
}: ProfileSetupProps) {
  const [username, setUsername] = useState(initialUsername);
  const [photoURL, setPhotoURL] = useState(initialPhotoURL);
  const [selectedColor, setSelectedColor] = useState<string>("#5b6cf6");
  const [isCustomPhoto, setIsCustomPhoto] = useState<boolean>(false);

  // Cropper state
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    onComplete({ username: username.trim(), photoURL });
  };

  if (imageToCrop) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-6 w-full max-w-md mx-auto">
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
            className="flex-1 py-3 rounded-xl bg-neutral-800 text-white font-semibold flex items-center justify-center gap-2 hover:bg-neutral-700 transition-colors"
          >
            <X size={18} /> Cancel
          </button>
          <button
            type="button"
            onClick={createCroppedImage}
            className="flex-1 py-3 rounded-xl bg-white text-black font-semibold flex items-center justify-center gap-2 hover:bg-neutral-200 transition-colors"
          >
            <Check size={18} /> Save Crop
          </button>
        </div>
      </div>
    );
  }

  const isEditMode = !!onCancel;

  return (
    <div className="flex flex-col items-center justify-center p-4 min-h-full w-full py-8">
      {/* Centered Modal Box matching Image 3 */}
      <div className="w-full max-w-md bg-[#121212] border border-neutral-800/90 rounded-3xl p-8 shadow-2xl flex flex-col items-center text-center">
        {/* White squircle with speech bubble icon */}
        <div className="w-16 h-16 rounded-2xl bg-white text-black flex items-center justify-center shadow-xl mb-5">
          <MessageSquare size={32} strokeWidth={2.2} />
        </div>

        {/* Heading */}
        <h2 className="text-2xl font-extrabold text-white tracking-tight mb-2">
          {isEditMode ? "Edit Profile" : "Join Community Chat"}
        </h2>

        {/* Subtitle */}
        <p className="text-neutral-400 text-xs mb-6 max-w-xs leading-relaxed">
          Real-time messaging &amp; voice rooms powered by Cloud Firestore.
        </p>

        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-5 text-left">
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
                maxLength={20}
                required
                className="w-full bg-[#0a0a0a] border border-neutral-800 focus:border-white text-white rounded-xl pl-10 pr-4 py-3 text-sm placeholder-neutral-600 focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* PICK AVATAR COLOR section */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-neutral-400 tracking-wider uppercase">
                PICK AVATAR COLOR
              </label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-[11px] font-semibold text-neutral-300 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer bg-neutral-900 border border-neutral-800 px-2.5 py-1 rounded-lg"
              >
                <Camera size={12} />
                <span>Custom Image</span>
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
                    className={`w-9 h-9 rounded-xl flex-shrink-0 transition-all cursor-pointer ${
                      isSelected
                        ? "scale-110 ring-2 ring-white ring-offset-2 ring-offset-[#121212]"
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
                className={`w-9 h-9 rounded-xl flex-shrink-0 bg-neutral-900 border border-neutral-700 flex items-center justify-center text-neutral-300 hover:text-white transition-all cursor-pointer overflow-hidden ${
                  isCustomPhoto ? "ring-2 ring-white ring-offset-2 ring-offset-[#121212]" : ""
                }`}
                title="Upload Custom Profile Picture"
              >
                {isCustomPhoto ? (
                  <img src={photoURL} alt="Custom" className="w-full h-full object-cover" />
                ) : (
                  <Camera size={16} />
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

          {/* Submit Button */}
          <div className="flex gap-2 pt-2">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="py-3.5 px-4 rounded-xl bg-neutral-900 text-white font-bold text-sm hover:bg-neutral-800 transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              id="enter-chat-submit-btn"
              type="submit"
              disabled={!username.trim()}
              className="flex-1 py-3.5 rounded-xl bg-neutral-300 hover:bg-white text-black font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span>{isEditMode ? "Save Changes" : "Enter Chat"}</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
