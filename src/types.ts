export interface Game {
  id: number | string;
  name: string;
  cover: string;
  url: string;
  author?: string;
  authorLink?: string;
  featured?: boolean;
  special?: string[];
  source?: "catalog" | "luminsdk";
  luminId?: string;
  isMod?: boolean;
  _search?: string;
}

export type SortOption = "name" | "id" | "popular";

export interface ChatProfile {
  uid: string;
  username: string;
  photoURL: string;
  isMuted?: boolean;
  isVideoOn?: boolean;
  isVideoLoading?: boolean;
  status?: "online" | "left" | "offline";
}

export interface ChatMessage {
  id: string;
  uid: string;
  username: string;
  photoURL: string;
  text?: string;
  gif?: string;
  attachment?: string;
  timestamp: number;
}

export interface VoiceSignal {
  id: string;
  senderId: string;
  receiverId: string;
  type: "offer" | "answer" | "candidate";
  data: string;
  timestamp: number;
}
