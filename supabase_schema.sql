-- Run this in your Supabase SQL Editor to create the tables

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    "channelId" TEXT,
    uid TEXT,
    username TEXT,
    "photoURL" TEXT,
    text TEXT,
    gif TEXT,
    attachment TEXT,
    timestamp BIGINT,
    edited BOOLEAN
);

CREATE TABLE IF NOT EXISTS presence (
    uid TEXT PRIMARY KEY,
    username TEXT,
    "photoURL" TEXT,
    status TEXT,
    "lastSeen" BIGINT,
    "isMuted" BOOLEAN,
    "inVoice" BOOLEAN
);

CREATE TABLE IF NOT EXISTS voice_users (
    uid TEXT PRIMARY KEY,
    "channelId" TEXT,
    username TEXT,
    "photoURL" TEXT,
    "isMuted" BOOLEAN,
    "isVideoOn" BOOLEAN,
    "isVideoLoading" BOOLEAN,
    timestamp BIGINT
);

-- Enable Realtime for all tables
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE presence;
ALTER PUBLICATION supabase_realtime ADD TABLE voice_users;

-- Relax RLS (Row Level Security) for public access (since this is an open chat room prototype)
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE presence DISABLE ROW LEVEL SECURITY;
ALTER TABLE voice_users DISABLE ROW LEVEL SECURITY;
