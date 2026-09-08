import { pgTable, varchar, text, bigint, boolean, timestamp } from "drizzle-orm/pg-core";

export const messages = pgTable("messages", {
  id: varchar("id", { length: 255 }).primaryKey(),
  uid: varchar("uid", { length: 255 }).notNull(),
  username: varchar("username", { length: 255 }).notNull(),
  photoURL: text("photo_url"),
  text: text("text"),
  gif: text("gif"),
  attachment: text("attachment"),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const presence = pgTable("presence", {
  uid: varchar("uid", { length: 255 }).primaryKey(),
  username: varchar("username", { length: 255 }).notNull(),
  photoURL: text("photo_url"),
  status: varchar("status", { length: 50 }).default("online").notNull(),
  lastSeen: bigint("last_seen", { mode: "number" }).notNull(),
  inVoice: boolean("in_voice").default(false),
  isMuted: boolean("is_muted").default(false),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const voiceUsers = pgTable("voice_users", {
  uid: varchar("uid", { length: 255 }).primaryKey(),
  username: varchar("username", { length: 255 }).notNull(),
  photoURL: text("photo_url"),
  isMuted: boolean("is_muted").default(false),
  isVideoOn: boolean("is_video_on").default(false),
  isVideoLoading: boolean("is_video_loading").default(false),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Presence = typeof presence.$inferSelect;
export type NewPresence = typeof presence.$inferInsert;
export type VoiceUser = typeof voiceUsers.$inferSelect;
export type NewVoiceUser = typeof voiceUsers.$inferInsert;
