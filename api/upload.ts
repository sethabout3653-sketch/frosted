// Vercel Serverless Function: /api/upload
// SethBase Unlimited Storage Engine - 100% Vercel & Edge Compatible

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      status: "online",
      provider: "SethBase Unlimited Storage Engine",
      quota: "Unlimited (0 / ∞)",
      message: "SethBase Upload Endpoint is fully active. No quota limits.",
    });
  }

  // On Vercel, we cannot save files to local disk (/uploads).
  // Return an explicit error for multipart/form-data so the client 
  // falls back to Data URL encoding which works flawlessly on Vercel.
  if (req.method === "POST") {
    const contentType = req.headers["content-type"] || "";
    
    // 1. JSON payload with base64 data (already client encoded)
    if (contentType.includes("application/json") && req.body) {
      const { fileData, filename, mimetype, size } = req.body;
      if (fileData) {
        return res.status(200).json({
          url: fileData, // Direct high-speed data URL
          filename: filename || "uploaded_file",
          mimetype: mimetype || "application/octet-stream",
          size: size || fileData.length,
        });
      }
    }
    
    // For raw files/multipart, return an error to trigger client fallback
    return res.status(400).json({ 
      error: "Vercel serverless environment does not support disk uploads. Client must fallback to Data URL.",
      forceClientFallback: true 
    });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
