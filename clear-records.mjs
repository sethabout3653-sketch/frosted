import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://jtocgfqurrlyyvhfmfsc.supabase.co';
const supabaseKey = 'sb_publishable_o5pFWa88vKImudzqdbVWkw_AyBOzXOj';

const supabase = createClient(supabaseUrl, supabaseKey);

async function clear() {
  console.log("Clearing messages from records table...");
  const { error } = await supabase.from('records').delete().eq('collection', 'messages');
  console.log("Messages deleted", error);
}

clear();
