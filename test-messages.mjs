import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://jtocgfqurrlyyvhfmfsc.supabase.co';
const supabaseKey = 'sb_publishable_o5pFWa88vKImudzqdbVWkw_AyBOzXOj';

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase.from('messages').select('*').limit(50);
  console.log("Data length:", data?.length, "Error:", error);
  if (data?.length > 0) {
    console.log("Sample:", data[0]);
  }
}

test();
