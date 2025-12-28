// ===================== SALVA.COACH - server.js =========================
// Chat con memoria + envío de resumen vía Webhook Gmail / Apps Script
// NO USA SMTP, NO USA MAILERSEND, NO USA RESEND
// ======================================================================

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ========== CONFIG ==========================================
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAIL_WEBHOOK_URL = process.env.MAIL_WEBHOOK_URL; // << ESTA ES LA QUE AÑADIRÁS EN RENDER

// Cliente OpenAI
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  project: process.env.OPENAI_PROJECT
});

// ========== MEMORIA =========================================
const sessions = new Map();
function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      history: [],
      email: null,
      summarySent: false
    });
  }
  return sessions.get(id);
}

function detectEmail(text) {
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
}

// ========== NUEVO sendMail (Webhooks Gmail) =================
async function sendMailSummary(sessionId, emailUser, history) {
  if (!MAIL_WEBHOOK_URL) {
    console.log("⚠️ MAIL_WEBHOOK_URL no configurada");
    return;
  }

  const payload = {
    to: "salva@veloxtrem.com",     // << tu correo entrenador
    userEmail: emailUser || null,
    sessionId,
    history
  };

  const resp = await fetch(MAIL_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error("Webhook fallo: " + text);
  }

  console.log("📨 Resumen enviado vía Webhook");
}

// ========== CHAT ============================================
app.post("/api/chat", async (req, res) => {
  try {
    const text = (req.body?.message || "").trim();
    const sessionId = String(req.body?.session || "default");

    if (!text) return res.json({ reply: "¿En qué puedo ayudarte?" });

    const state = getSession(sessionId);

    // Detectar email del usuario
    const email = detectEmail(text);
    if (email && !state.email) {
      state.email = email;
      state.summarySent = false;
      console.log("📧 email detectado:", email);
    }

    // Mensajes combinando historial
    const messages = [
      { role: "system", content: "Eres SALVA.COACH, entrenador de ciclismo de VELOXTREM. Responde de forma cercana, profesional y clara, en español." },
      ...state.history,
      { role: "user", content: text }
    ];

    const completion = await client.chat.completions.create({ model: MODEL, messages });
    const reply = completion.choices?.[0]?.message?.content || "No tengo respuesta.";

    // Guardar historial
    state.history.push({ role: "user", content: text });
    state.history.push({ role: "assistant", content: reply });

    // Detectar cierre y enviar resumen
    const closingWords = /\b(gracias|perfecto|ok|vale|genial|nos vemos|adiós|hasta luego|listo)\b/i;
    const isClosing = closingWords.test(text);

    if (isClosing && !state.summarySent) {
      await sendMailSummary(sessionId, state.email, state.history);
      state.summarySent = true;
      console.log("🎉 Resumen enviado automáticamente");
    }

    res.json({ reply });

  } catch (err) {
    console.error("❌ Error /api/chat:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ========== TEST =============================================
app.get("/email-test", async (req, res) => {
  try {
    await sendMailSummary("test-session", "test@correo.com", [
      { role: "user", content: "Hola" },
      { role: "assistant", content: "Hola deportista" }
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ========== START ============================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 SALVA.COACH server escuchando en puerto ${PORT}`);
});
