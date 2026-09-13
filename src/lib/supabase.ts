/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_URL) ||
  'https://ouqxhjnvsvqwlloyqdsl.supabase.co';

export const SUPABASE_ANON_KEY = 
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91cXhoam52c3Zxd2xsb3lxZHNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMTA4NTQsImV4cCI6MjEwNDg4Njg1NH0.0_upzI9WwQj3GRb1ALDbWPMH_Y4cWuk5i9YTOzknhu0';

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
