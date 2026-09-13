import { pgTable, text, bigint, index } from 'drizzle-orm/pg-core';

export const records = pgTable('records', {
  collection: text('collection').notNull(),
  id: text('id').primaryKey(),
  data: text('data').notNull(),
  timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
}, (table) => {
  return {
    collectionIdx: index('idx_records_collection').on(table.collection),
  };
});

export const webrtcSignals = pgTable('webrtc_signals', {
  id: text('id').primaryKey(),
  targetUid: text('target_uid').notNull(),
  uid: text('uid').notNull(),
  payload: text('payload').notNull(),
  timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
});
