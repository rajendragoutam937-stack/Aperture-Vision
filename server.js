const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

app.use(express.json({ limit: "12mb" }));
app.use(express.static(__dirname));

app.get("/api/status", (_req, res) => {
  res.json({
    server: "online",
    groqConfigured: Boolean(GROQ_API_KEY),
    chatModel: process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b",
    visionModel: process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b"
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    if (!GROQ_API_KEY) {
      return res.status(503).json({ error: "Groq is not configured. Add GROQ_API_KEY in Render Environment." });
    }

    const { messages, image } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Please provide a message." });
    }

    const safeMessages = messages.slice(-12).map((m) => ({
      role: ["user", "assistant"].includes(m.role) ? m.role : "user",
      content: typeof m.content === "string" ? m.content.slice(0, 8000) : ""
    }));

    const systemMessage = {
      role: "system",
      content: "You are Aperture Vision, a helpful visual AI assistant. Answer clearly and accurately. If the user asks about health, give general educational information only; do not diagnose or replace a qualified professional. If uncertain about an image, say so."
    };

    if (image && typeof image === "string" && image.startsWith("data:image/")) {
      const lastUserIndex = safeMessages.map(m => m.role).lastIndexOf("user");
      if (lastUserIndex < 0) return res.status(400).json({ error: "A user message is required with an image." });
      const userText = safeMessages[lastUserIndex].content || "Describe this image.";
      safeMessages[lastUserIndex] = {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: image } }
        ]
      };
    }

    const model = image
      ? (process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b")
      : (process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b");

    const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [systemMessage, ...safeMessages],
        temperature: 0.5,
        max_tokens: 1200
      })
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      const message = data?.error?.message || `Groq returned HTTP ${upstream.status}`;
      return res.status(upstream.status).json({ error: message });
    }

    const answer = data?.choices?.[0]?.message?.content;
    if (!answer) return res.status(502).json({ error: "Groq returned an empty response." });
    res.json({ answer, model });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "The server could not complete the AI request." });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => console.log(`Aperture Vision running on port ${PORT}`));
