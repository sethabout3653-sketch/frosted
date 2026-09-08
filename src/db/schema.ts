import { pgTable, text, timestamp, bigint, boolean } from "drizzle-orm/pg-core";

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  uid: text("uid").notNull(),
  username: text("username").notNull(),
  photoUrl: text("photo_url"),
  text: text("text"),
  gif: text("gif"),
  attachment: text("attachment"),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const presence = pgTable("presence", {
  uid: text("uid").primaryKey(),
  username: text("username").notNull(),
  photoUrl: text("photo_url"),
  status: text("status").notNull(),
  lastSeen: bigint("last_seen", { mode: "number" }).notNull(),
  inVoice: boolean("in_voice").default(false),
  isMuted: boolean("is_muted").default(false),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const voiceUsers = pgTable("voice_users", {
  uid: text("uid").primaryKey(),
  username: text("username").notNull(),
  photoUrl: text("photo_url"),
  isMuted: boolean("is_muted").default(false),
  isVideoOn: boolean("is_video_on").default(false),
  isVideoLoading: boolean("is_video_loading").default(false),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const signals = pgTable("signals", {
  id: text("id").primaryKey(),
  senderId: text("sender_id").notNull(),
  receiverId: text("receiver_id").notNull(),
  type: text("type").notNull(),
  data: text("data").notNull(),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
