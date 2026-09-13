/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_URL) ||
  'https://jtocgfqurrlyyvhfmfsc.supabase.co';

export const SUPABASE_ANON_KEY = 
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) ||
  'sb_publishable_o5pFWa88vKImudzqdbVWkw_AyBOzXOj';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 100, // Unlimited high-throughput real-time events
    },
  },
});
