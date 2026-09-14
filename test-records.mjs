import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://jtocgfqurrlyyvhfmfsc.supabase.co';
const supabaseKey = 'sb_publishable_o5pFWa88vKImudzqdbVWkw_AyBOzXOj';

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase.from('records').select('*').eq('collection', 'messages');
  console.log("Records length:", data?.length, "Error:", error);
}

test();
