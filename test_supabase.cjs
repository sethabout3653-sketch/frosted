const { createClient } = require("@supabase/supabase-js");
const supabaseUrl = "https://jtocgfqurrlyyvhfmfsc.supabase.co";
const supabaseAnonKey = "sb_publishable_o5pFWa88vKImudzqdbVWkw_AyBOzXOj";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function test() {
  const { data, error } = await supabase.from("presence").select("*").limit(1);
  console.log("Presence table check:", error ? error.message : "Exists! Rows: " + data.length);
  
  const { data: d2, error: e2 } = await supabase.from("messages").select("*").limit(1);
  console.log("Messages table check:", e2 ? e2.message : "Exists! Rows: " + d2.length);
}
test();
