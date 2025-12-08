// ======================================================
// SALVA.COACH – servidor completo con chat y auto-resumen
// ======================================================

require("dotenv").config();  // carga variables desde .env
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

// --------- MIDDLEWARE ---------
app.use(bodyParser.json());
app.use(cors({
  origin: [
    "https://www.veloxtrem.com",
    "https://https://inapplicably-uncupped-addison.ngrok-free.dev"
  ],
  methods: ["GET", "POST"]
}));

// --------- PROMPT DEL NEGOCIO (AJÚSTALO A TU TEXTO REAL) ---------
const SALVA_SYSTEM_PROMPT = `
Eres SALVA.COACH de VELOXTREM. Hablas en primera persona, claro y profesional.
Ámbito: solo ciclismo. Para triatletas, atiende solo la parte de ciclismo.
Objetivo: entender al deportista y recomendar el pack adecuado.
Prioriza SIEMPRE “Pack 1 a 1” y “Pack Premium” si encajan; si no, ofrece el resto sin presión.
No ofrezcas más de 2 opciones a la vez.

Checklist interna (no repitas lo ya dado): nombre, objetivo+fecha, experiencia/estado,
peso/altura (si quiere), disponibilidad (días/horas), método (vatios o FC), restricciones/salud/material/horarios, email.
En cada turno: pregunta solo lo que falte. Responde en 5–10 líneas. Resume y pide confirmación.

CATÁLOGO (ejemplo):
1) Pack 1 a 1 — PRECIO_1A1 €/mes (personalizado 1:1, ajustes ilimitados, contacto prioritario)
2) Pack Premium — 150 €/mes (plan adaptativo avanzado, análisis, llamadas programadas)
Resto de packs: Quebrantahuesos 2026, Base por FC 8/12, Inicia Base por vatios, Fuerza por vatios.

Cierre: pide email para la propuesta, ofrece siguiente paso (afinar/contratar/hablar con entrenador).
Notas: no se envían emails por cada mensaje. Hay botón “Enviar resumen”.
`;

// --------- TRANSCRIPCIÓN Y TIMERS (POR sessionId) ---------
const transcripts = new Map(); // sid -> [{role, content, ts}]
const timers = new Map();      // sid -> timeoutId
const INACTIVITY_MS = 1000 * 60 * 120; // 2 horas

function pushMsg(sid, role, content) {
  const list = transcripts.get(sid) || [];
  list.push({ role, content, ts: Date.now() });
  transcripts.set(sid, list);
  resetTimer(sid);
}
function resetTimer(sid) {
  const t = timers.get(sid);
  if (t) clearTimeout(t);
  const nt = setTimeout(() => sendSummary(sid, "auto-2h"), INACTIVITY_MS);
  timers.set(sid, nt);
}
function buildTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error("Faltan SMTP_HOST, SMTP_USER o SMTP_PASS");
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: (Number(SMTP_PORT) === 465),
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    requireTLS: (Number(SMTP_PORT) === 587)
  });
}
async function sendSummary(sid, reason) {
  const list = transcripts.get(sid) || [];
  if (!list.length) return;
  const to = process.env.TO_EMAIL;
  if (!to) { console.warn("Falta TO_EMAIL"); return; }

  const tx = buildTransport();
  const body = list.map(
    x => `[${new Date(x.ts).toISOString()}] ${x.role.toUpperCase()}: ${x.content}`
  ).join("\n");

  await tx.sendMail({
    from: `SALVA.COACH <${process.env.SMTP_USER}>`,
    to,
    subject: `Resumen SALVA.COACH (${reason})`,
    text: body
  });

  transcripts.delete(sid);
  const t = timers.get(sid);
  if (t) clearTimeout(t);
  timers.delete(sid);
}

// --------- RUTAS ---------
app.get("/health", (_, res) => res.send("ok"));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

app.post("/chat", async (req, res) => {
  try {
    const { messages = [], sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ ok:false, error:"Falta sessionId" });

    // Guarda el último turno de usuario
    const lastUser = [...messages].reverse().find(m => m.role === "user");
    if (lastUser?.content) pushMsg(sessionId, "user", lastUser.content);

    // Respuesta demo si no hay API key; real si hay OPENAI_API_KEY
    let content = "Hola, soy SALVA.COACH – VELOXTREM. ¿En qué te ayudo?";
    if (process.env.OPENAI_API_KEY) {
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SALVA_SYSTEM_PROMPT },
          ...messages.map(m => ({ role: m.role, content: m.content }))
        ],
        temperature: 0.6,
        max_tokens: 600
      });
      content = completion.choices?.[0]?.message?.content || content;
    }

    pushMsg(sessionId, "assistant", content);
    res.json({ ok: true, content });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

// Botón “Enviar resumen”
app.post("/email-summary", async (req, res) => {
  try {
    const { sessionId, messages = [] } = req.body || {};
    if (!sessionId) return res.status(400).json({ ok:false, error:"Falta sessionId" });
    if (messages.length) transcripts.set(sessionId, messages.map(m => ({role:m.role, content:m.content, ts:Date.now()})));
    await sendSummary(sessionId, "manual");
    res.json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

// Fin conversación (cierre/reset/salida)
app.post("/end-conversation", async (req, res) => {
  try {
    const { sessionId, messages = [], reason = "fin" } = req.body || {};
    if (!sessionId) return res.status(400).json({ ok:false, error:"Falta sessionId" });
    if (messages.length) transcripts.set(sessionId, messages.map(m => ({role:m.role, content:m.content, ts:Date.now()})));
    await sendSummary(sessionId, reason);
    res.json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});

// Arranque
app.listen(PORT, () => console.log(`✅ SALVA.COACH activo en http://localhost:${PORT}`));