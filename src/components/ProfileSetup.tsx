import React, { useState, useRef } from "react";
import Cropper from "react-easy-crop";
import { Camera, Check, X } from "lucide-react";

const DEFAULT_AVATARS = [
  "https://api.dicebear.com/7.x/bottts/svg?seed=frosted1",
  "https://api.dicebear.com/7.x/bottts/svg?seed=frosted2",
  "https://api.dicebear.com/7.x/bottts/svg?seed=frosted3",
  "https://api.dicebear.com/7.x/bottts/svg?seed=frosted4",
  "https://api.dicebear.com/7.x/bottts/svg?seed=frosted5",
  "https://api.dicebear.com/7.x/bottts/svg?seed=frosted6",
];

interface ProfileSetupProps {
  initialUsername?: string;
  initialPhotoURL?: string;
  onComplete: (profile: { username: string; photoURL: string }) => void;
  onCancel?: () => void;
}

export default function ProfileSetup({ initialUsername = "", initialPhotoURL = DEFAULT_AVATARS[0], onComplete, onCancel }: ProfileSetupProps) {
  const [username, setUsername] = useState(initialUsername);
  const [photoURL, setPhotoURL] = useState(initialPhotoURL);
  
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

  const onCropComplete = (croppedArea: any, croppedAreaPixels: any) => {
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
    setImageToCrop(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    onComplete({ username: username.trim(), photoURL });
  };

  if (imageToCrop) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-4">
        <h3 className="text-xl font-bold mb-4 text-white">Crop Profile Picture</h3>
        <div className="relative w-full h-64 bg-black rounded-lg overflow-hidden mb-4">
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
          className="w-full mb-6 accent-white"
        />
        <div className="flex gap-3 w-full">
          <button
            onClick={() => setImageToCrop(null)}
            className="flex-1 py-2 rounded-lg bg-neutral-800 text-white font-semibold flex items-center justify-center gap-2"
          >
            <X size={18} /> Cancel
          </button>
          <button
            onClick={createCroppedImage}
            className="flex-1 py-2 rounded-lg bg-white text-black font-semibold flex items-center justify-center gap-2"
          >
            <Check size={18} /> Save Crop
          </button>
        </div>
      </div>
    );
  }

  const isEditMode = !!onCancel;

  return (
    <div className="flex flex-col items-center justify-center p-6 h-full max-w-sm mx-auto w-full">
      <h2 className="text-2xl font-bold text-white mb-2">{isEditMode ? "Edit Profile" : "Join Chat"}</h2>
      <p className="text-neutral-400 text-sm mb-8 text-center">{isEditMode ? "Update your username and profile picture." : "Pick a username and profile picture to start chatting."}</p>

      <form onSubmit={handleSubmit} className="w-full flex flex-col gap-6">
        <div className="flex flex-col items-center gap-4">
          <div className="relative group">
            <img src={photoURL} alt="Avatar" className="w-24 h-24 rounded-full object-cover border-2 border-neutral-700 group-hover:border-white transition-colors" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute bottom-0 right-0 bg-neutral-800 p-2 rounded-full border border-neutral-600 text-white hover:bg-neutral-700 transition-colors shadow-lg"
            >
              <Camera size={14} />
            </button>
            <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
          </div>

          <div className="grid grid-cols-6 gap-2 w-full">
            {DEFAULT_AVATARS.map((avatar, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setPhotoURL(avatar)}
                className={`w-full aspect-square rounded-full overflow-hidden border-2 transition-all ${
                  photoURL === avatar ? "border-white scale-110" : "border-transparent opacity-50 hover:opacity-100"
                }`}
              >
                <img src={avatar} alt={`Avatar ${i}`} className="w-full h-full object-cover bg-neutral-800" />
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="CoolGamer99"
            maxLength={20}
            required
            className="w-full bg-neutral-900 border border-neutral-800 text-white rounded-lg px-4 py-3 outline-none focus:border-white transition-colors"
          />
        </div>

        <div className="flex gap-3 pt-4">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-3 rounded-lg bg-neutral-900 text-white font-bold hover:bg-neutral-800 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={!username.trim()}
            className="flex-1 py-3 rounded-lg bg-white text-black font-bold hover:bg-neutral-200 transition-colors disabled:opacity-50"
          >
            {isEditMode ? "Save Changes" : "Let's Go!"}
          </button>
        </div>
      </form>
    </div>
  );
}
