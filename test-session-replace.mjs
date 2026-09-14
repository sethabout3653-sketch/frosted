const LUMIN_API_BASE = "https://a.luminsdk.com";

async function test() {
  const sessionRes = await fetch(`${LUMIN_API_BASE}/api/v1/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const { session_id } = await sessionRes.json();
  console.log("Fresh Session ID:", session_id);

  const expiredToken = "1788382934-UIsP4iQ_aC_ouGAn_Vf6o0WXELqT7tmu0X-7cdrpqc4/selenite/wordlebot";
  const freshToken = expiredToken.replace(/^[^/]+/, session_id);
  console.log("Fresh Token:", freshToken);

  const url = `https://a.luminsdk.com/api/v1/assets/${freshToken}`;
  const res = await fetch(url, { method: "HEAD" });
  console.log("Status:", res.status);
}

test();
