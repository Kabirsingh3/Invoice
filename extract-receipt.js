// Vercel serverless function. Runs server-side, so the Anthropic API key
// never reaches the browser. Called by the "Scan receipt" button on a job
// card (see App.jsx).

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY. Add it in Vercel's Environment Variables." });
    return;
  }

  const { imageBase64, mediaType } = req.body || {};
  if (!imageBase64 || !mediaType) {
    res.status(400).json({ error: "Missing image data." });
    return;
  }

  const prompt = `This image is a photo of a purchase receipt for spare parts or materials bought for a job.
Extract the vendor/store name, the date if visible, every line item with its price, and the total.
Respond with ONLY valid JSON, no markdown code fences, no extra commentary, in exactly this shape:
{"vendor":"","date":"","items":[{"desc":"","amount":0}],"total":0}
Use an empty string or 0 for anything you cannot read. "date" should be YYYY-MM-DD if determinable, otherwise an empty string. "amount" and "total" must be plain numbers (no currency symbols).`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
              { type: "text", text: prompt }
            ]
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(502).json({ error: data?.error?.message || "The AI service returned an error." });
      return;
    }

    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) {
      res.status(502).json({ error: "No text in the AI response." });
      return;
    }

    const cleaned = textBlock.text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      res.status(502).json({ error: "Couldn't parse what the AI returned.", raw: textBlock.text });
      return;
    }

    res.status(200).json({
      vendor: parsed.vendor || "",
      date: parsed.date || "",
      items: Array.isArray(parsed.items)
        ? parsed.items.map((it) => ({ desc: String(it.desc || ""), amount: Number(it.amount) || 0 }))
        : [],
      total: Number(parsed.total) || 0
    });
  } catch (err) {
    res.status(500).json({ error: "Request to the AI service failed: " + err.message });
  }
}
