import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://jtocgfqurrlyyvhfmfsc.supabase.co';
const supabaseKey = 'sb_publishable_o5pFWa88vKImudzqdbVWkw_AyBOzXOj';

const supabase = createClient(supabaseUrl, supabaseKey);

async function clear() {
  console.log("Clearing messages...");
  const { error: e1 } = await supabase.from('messages').delete().neq('id', '0');
  console.log("Messages deleted", e1);
}

clear();
