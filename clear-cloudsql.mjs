import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.SQL_HOST,
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DB_NAME,
});

async function clear() {
  console.log("Clearing messages from Cloud SQL...");
  try {
    const res = await pool.query("DELETE FROM records WHERE collection = 'messages'");
    console.log(`Deleted ${res.rowCount} messages`);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    pool.end();
  }
}

clear();
