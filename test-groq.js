const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
async function test() {
  const contentParts = [
    { type: "text", text: "Analyze the following text for inappropriate content: \"hello\"" },
    { type: "text", text: "Respond ONLY in raw JSON. Determine if the content is safe. Set 'safe' to true if it is completely safe. Set 'safe' to false if it contains ANY inappropriate content. MUST BE VALID JSON: {\"safe\": boolean, \"reason\": \"string\"}" }
  ];
  const orRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-safeguard-20b",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: contentParts
        }
      ]
    })
  });
  console.log(orRes.status);
  console.log(await orRes.text());
}
test();
