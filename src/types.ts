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
  lastSeen?: number;
  timestamp?: number;
}

export interface ChatMessage {
  id: string;
  channelId?: string;
  uid: string;
  username: string;
  photoURL: string;
  text?: string;
  gif?: string;
  attachment?: string;
  attachmentType?: string;
  attachmentName?: string;
  attachmentSize?: number;
  timestamp: number;
  reactions?: Record<string, string[]>;
  _isOptimistic?: boolean;
}

export interface VoiceSignal {
  id: string;
  uid: string;
  targetUid: string;
  type: "offer" | "answer" | "candidate";
  sdp: string;
  timestamp: number;
}

export type CallStatus =
  | "ringing"     // Call is ringing on recipient & caller ends
  | "accepted"    // Call answered & active
  | "declined"    // Recipient declined
  | "cancelled"   // Caller hung up before answer
  | "ended"       // Active call was hung up
  | "missed";     // Timed out with no answer

export interface DirectCallSession {
  id: string;
  callerUid: string;
  callerName: string;
  callerPhoto: string;
  targetUid: string;
  targetName: string;
  targetPhoto: string;
  status: CallStatus;
  isVideoCall: boolean;
  createdAt: number;
  acceptedAt?: number;
  endedAt?: number;
  isEchoTest?: boolean;
}

export interface CallSignalPayload {
  callId: string;
  type: "call_invite" | "call_accept" | "call_decline" | "call_cancel" | "call_end" | "call_webrtc_offer" | "call_webrtc_answer" | "call_webrtc_candidate";
  caller: {
    uid: string;
    username: string;
    photoURL: string;
  };
  target: {
    uid: string;
    username: string;
    photoURL: string;
  };
  isVideo?: boolean;
  sdp?: any;
  candidate?: any;
  timestamp: number;
}
