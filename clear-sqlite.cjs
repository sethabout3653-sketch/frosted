const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(process.cwd(), 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run("DELETE FROM records WHERE collection = 'messages'", function(err) {
    if (err) {
      console.error(err.message);
    }
    console.log(`Deleted ${this.changes} row(s) from SQLite messages`);
  });
});

db.close();
