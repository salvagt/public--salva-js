// server.js — SALVA.COACH con memoria + emails por SMTP (Hostinger)
// Envío automático de resumen al cerrar la conversación.

require("dotenv").config({ override: false });
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const OpenAI = require("openai");

// ====================== CONFIG ENV ======================
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "salva@veloxtrem.com";
const FROM_NAME = process.env.FROM_NAME || "SALVA.COACH";

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "465", 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

console.log("ENV CHECK =>", {
  hasOpenAIKey: !!process.env.OPENAI_API_KEY,
  hasProject: !!process.env.OPENAI_PROJECT,
  model: MODEL,
  adminEmail: ADMIN_EMAIL,
  smtpHost: SMTP_HOST,
  smtpUser: SMTP_USER,
});

// ====================== SMTP (SOLO) ======================
let transporter = null;

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  console.log("⚠️  SMTP NO CONFIGURADO — revisa SMTP_HOST / SMTP_USER / SMTP_PASS en Render");
} else {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

async function sendMail({ to, subject, html }) {
  if (!transporter) throw new Error("SMTP no configurado");
  const fromHeader = `"${FROM_NAME}" <${SMTP_USER}>`;
  const info = await transporter.sendMail({ from: fromHeader, to, subject, html });
  console.log("✉️ Email enviado:", info.response);
  return info;
}

// ====================== CLIENTE OPENAI ===================
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  project: process.env.OPENAI_PROJECT,
});

// ====================== APP EXPRESS ======================
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.status(200).send("ok"));

// ====================== MEMORIA POR SESIÓN ===============
/*
sessions: Map<sessionId, {
  history: {role:'user'|'assistant', content:string}[],
  email: string|null,
  summarySent: boolean
}>
*/
const sessions = new Map();

function getSession(id) {
  if (!id) return null;
  if (!sessions.has(id)) {
    sessions.set(id, {
      history: [],
      email: null,
      summarySent: false,
    });
  }
  return sessions.get(id);
}

function trimHistory(arr, max = 20) {
  return arr.length > max ? arr.slice(arr.length - max) : arr;
}

// ====================== PROMPT ===========================
const SALVA_PROMPT = `
Eres SALVA.COACH, entrenador de ciclismo de VELOXTREM. Sé humano, cercano y profesional. Usa emojis solo cuando aporten calidez 😊🚴‍♂️💪.

FLUJO GENERAL:
1) Primer mensaje: saluda muy breve y pregunta objetivo principal, nivel actual y disponibilidad (horas/semana).
2) En los siguientes 1–2 mensajes, EN CUANTO tengas claro el objetivo inicial, PIDE SIEMPRE:
   - Nombre
   - Tipo de ciclismo (carretera, MTB, gravel, mixto…)
   - Disponibilidad semanal aproximada
   - Correo electrónico de contacto
   Debes hacerlo pronto, NO lo retrases al final de la conversación.
3) Cuando proceda, recomienda máximo 1–2 packs (prioriza 1 a 1 y Premium). No repitas packs de forma insistente.
4) Si ya recomendaste, entra en modo entrenador: técnica, estructura de entrenos, fuerza, nutrición, descanso, mentalidad.
5) Si ya tienes el email, confirma y da 1–3 pasos claros siguientes (por ejemplo: revisar datos, enviar propuesta, posible llamada rápida).

CATÁLOGO PRINCIPAL:
- 🏅 1 a 1 VELOXTREM — 100 €/mes.
- 🔥 Premium VELOXTREM — 150 €/mes.
OTROS:
- 🏔 QH 2026 — 399 € (24 semanas).
- 💪 Base por FC — 8 semanas (89 €) y 12 semanas (99 €).
- ⚙️ Fuerza específica por vatios — 69 €.

REGLAS:
- Responde primero a la duda concreta del deportista.
- Da 2–4 frases de valor real.
- Cierra casi siempre con una sola pregunta que ayude a avanzar.
- No repitas información que ya hayas dado salvo que el deportista lo pida.
- No sigas hablando de packs si ya los has recomendado una vez.
`;

// ====================== UTILIDADES =======================
function detectEmail(text) {
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
}

function renderHistoryHTML(history) {
  return history
    .map((h) => `<p><b>${h.role === "user" ? "👤 Deportista" : "🤖 SALVA"}</b>: ${h.content}</p>`)
    .join("");
}

// ====================== EMAILS DE RESUMEN =================
async function sendAdminSummary({ sessionId, emailUser, history }) {
  const html = `
    <h2>Nuevo contacto desde SALVA.COACH</h2>
    <p><b>Sesión:</b> ${sessionId}</p>
    <p><b>Correo del deportista:</b> ${emailUser || "(no proporcionado)"}</p>
    <hr/>
    ${renderHistoryHTML(history)}
    <hr/>
    <p><i>Resumen automático – VELOXTREM</i></p>
  `;
  await sendMail({
    to: ADMIN_EMAIL,
    subject: `💬 Nuevo contacto - SALVA.COACH (${emailUser || "sin correo"})`,
    html,
  });
}

async function sendUserReceipt({ emailUser, history }) {
  if (!emailUser) return;
  const textSummary = history
    .slice(-10)
    .map((h) => `${h.role === "user" ? "Deportista" : "SALVA"}: ${h.content}`)
    .join("\n");

  const html = `
    <p>¡Gracias por contactar con SALVA.COACH! Aquí tienes un resumen de nuestra conversación.</p>
    <pre style="background:#f6f7f9;padding:12px;border-radius:8px;white-space:pre-wrap;">${textSummary}</pre>
    <p>Siguientes pasos: revisaré tu información y, si procede, te propondré un plan más detallado.</p>
    <p>— ${FROM_NAME} · VELOXTREM</p>
  `;
  await sendMail({
    to: emailUser,
    subject: "Tu resumen de la conversación con SALVA.COACH",
    html,
  });
}

// ====================== TEST SMTP ========================
app.get("/email-test", async (_req, res) => {
  try {
    await sendMail({
      to: ADMIN_EMAIL,
      subject: "Test — SALVA.COACH SMTP",
      html: "<p>Correo test enviado correctamente al ADMIN_EMAIL.</p>",
    });
    res.json({ ok: true, to: ADMIN_EMAIL });
  } catch (err) {
    console.error("❌ /email-test:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ====================== API CHAT =========================
app.post("/api/chat", async (req, res) => {
  try {
    const text = (req.body?.message || "").trim().slice(0, 4000);
    const sessionId = (req.body?.session || "").toString().slice(0, 100);

    if (!text) return res.json({ reply: "¿En qué puedo ayudarte? 🙂" });
    if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_PROJECT) {
      return res.status(500).json({ error: "config_error", detail: "Falta OPENAI_API_KEY o OPENAI_PROJECT" });
    }

    const state = getSession(sessionId || "default");
    state.history = trimHistory(state.history);

    // Detectar email en el mensaje
    const emailFound = detectEmail(text);
    if (emailFound && !state.email) {
      state.email = emailFound;
      state.summarySent = false;
      console.log("📧 Email detectado:", state.email);
    }

    const messages = [
      { role: "system", content: SALVA_PROMPT },
      ...state.history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: text },
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.7,
      top_p: 0.9,
      messages,
    });

    let reply = (completion.choices?.[0]?.message?.content || "").trim();

    // Guardar historial
    state.history.push({ role: "user", content: text });
    state.history.push({ role: "assistant", content: reply });
    state.history = trimHistory(state.history);

    // Palabras de cierre (solo envía resumen al entrenador)
    const closingWords =
      /\b(gracias|perfecto|genial|ok|vale|de acuerdo|hablamos|listo|hasta luego|buenas noches|nos vemos|adiós|bye|thanks|thank you)\b/i;
    const closing = closingWords.test(text);

    if (closing && !state.summarySent) {
      try {
        // Siempre enviar el resumen completo al entrenador
        await sendAdminSummary({
          sessionId: sessionId || "default",
          emailUser: state.email,
          history: state.history,
        });

        // Si en el futuro quieres enviar también al deportista, descomenta esta línea:
        // await sendUserReceipt({ emailUser: state.email, history: state.history });

        state.summarySent = true;

        reply += "\n\n✅ He enviado el resumen de esta conversación al entrenador VELOXTREM.";
        state.history[state.history.length - 1].content = reply;

        console.log("✅ Resumen auto-enviado al entrenador:", {
          sessionId: sessionId || "default",
          userEmail: state.email || "(sin email)",
        });
      } catch (e) {
        console.error("❌ Error enviando resumen:", e.message);
      }
    }

    return res.json({ reply });
  } catch (err) {
    console.error("❌ Error /api/chat:", err.message);
    res.status(500).json({ error: "chat_error", detail: err.message });
  }
});

// ====================== ARRANQUE =========================
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 SALVA.COACH activo en puerto ${PORT}`);
});
