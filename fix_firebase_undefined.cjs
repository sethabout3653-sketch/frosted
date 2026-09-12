const fs = require('fs');
let code = fs.readFileSync('src/firebase.ts', 'utf8');

code = code.replace(
  /export async function sendBroadcastSignal\(signal: any\) \{\s*const payload = \{\s*\.\.\.signal,\s*timestamp: Date\.now\(\),\s*\};\s*/g,
  `export async function sendBroadcastSignal(signal: any) {
  const payload = {
    ...signal,
    timestamp: Date.now(),
  };
  Object.keys(payload).forEach(key => {
    if (payload[key] === undefined) {
      delete payload[key];
    }
  });
  `
);

fs.writeFileSync('src/firebase.ts', code);
console.log("Firebase undefined fix applied!");
