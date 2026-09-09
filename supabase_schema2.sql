CREATE TABLE IF NOT EXISTS signals (
    id TEXT PRIMARY KEY,
    "channelId" TEXT,
    uid TEXT,
    "targetUid" TEXT,
    type TEXT,
    "sdp" TEXT,
    "candidate" TEXT,
    "sdpMid" TEXT,
    "sdpMLineIndex" INT,
    timestamp BIGINT
);

CREATE TABLE IF NOT EXISTS typing (
    id TEXT PRIMARY KEY,
    uid TEXT,
    username TEXT,
    "channelId" TEXT,
    timestamp BIGINT
);

ALTER PUBLICATION supabase_realtime ADD TABLE signals;
ALTER PUBLICATION supabase_realtime ADD TABLE typing;

ALTER TABLE signals DISABLE ROW LEVEL SECURITY;
ALTER TABLE typing DISABLE ROW LEVEL SECURITY;
