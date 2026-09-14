const LUMIN_API_BASE = "https://a.luminsdk.com";

async function test() {
  const sessionRes = await fetch(`${LUMIN_API_BASE}/api/v1/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const { session_id } = await sessionRes.json();
  console.log("Session ID:", session_id);

  const token = `${session_id}/selenite/wordlebot`;

  const urls = [
    `https://a.luminsdk.com/api/v1/assets/${token}`,
    `https://a.luminsdk.com/assets/${token}`,
    `https://a.luminsdk.com/api/v1/games/image/${token}`,
    `https://a.luminsdk.com/images/${token}`,
    `https://a.luminsdk.com/api/v1/images/${token}`,
    `https://a.luminsdk.com/api/v1/games/${token}/image`
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      console.log(`URL: ${url} -> Status: ${res.status}`);
    } catch (e) {
      console.log(`URL: ${url} -> Error: ${e.message}`);
    }
  }
}

test();
