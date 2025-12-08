// server.js — SALVA.COACH con memoria + resumen por correo
require('dotenv').config({ override: false });
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ===== Config =====
const HAS_KEY = !!process.env.OPENAI_API_KEY;
const HAS_PROJECT = !!process.env.OPENAI_PROJECT;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'salva@veloxtrem.com';
console.log('ENV CHECK =>', { HAS_KEY, HAS_PROJECT, MODEL, ADMIN_EMAIL });

// ===== OpenAI client =====
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  project: process.env.OPENAI_PROJECT
});

// ===== Nodemailer transporter =====
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// ===== Memoria por sesión =====
const sessions = new Map();
function getSession(id) {
  if (!id) return null;
  if (!sessions.has(id)) {
    sessions.set(id, {
      history: [],
      packsRecommended: false,
      email: null,
      summarySent: false
    });
  }
  return sessions.get(id);
}
function trimHistory(arr, max = 15) {
  return arr.length > max ? arr.slice(arr.length - max) : arr;
}

// ===== Prompt principal =====
const SALVA_PROMPT = `
Eres SALVA.COACH, entrenador de ciclismo de VELOXTREM. Sé humano, natural, empático y profesional. Usa emojis cuando aporten energía positiva 😊🚴‍♂️💪.

OBJETIVO:
- Guiar al deportista con preguntas sobre su objetivo, experiencia y tiempo disponible.
- Recomendar solo 1–2 packs (1 a 1 o Premium) y no repetirlos.
- Entrar en modo entrenador cuando pregunte por entrenamientos o técnica.
- Si muestra interés, pide su email para enviarle la propuesta.
- Si ya te da su correo, confírmalo y despídete de forma cercana.

PACKS PRINCIPALES:
1️⃣ Pack 1 a 1 VELOXTREM — 100 €/mes  
2️⃣ Pack Premium VELOXTREM — 150 €/mes  

OTROS:
🏔 QH 2026 — 399 €  
💪 Base por FC — 8 semanas (89 €) / 12 semanas (99 €)  
⚙️ Fuerza específica por vatios — 69 €

CONDICIONES:
- No repitas packs ya ofrecidos.
- Si el deportista ya tiene claro su objetivo, avanza: planifica o pide email.
- Cuando detectes un correo, di algo como “Perfecto, te escribiré ahí para continuar 🚀”.
`;

// ===== Detectar correos en el texto =====
function detectEmail(text) {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
}

// ===== Enviar resumen =====
async function sendSummaryEmail(sessionId, emailUser, history) {
  try {
    const body = history.map(h =>
      `<p><b>${h.role === 'user' ? '👤 Deportista:' : '🤖 SALVA:'}</b> ${h.content}</p>`
    ).join('');

    const html = `
      <h2>Nuevo contacto desde SALVA.COACH</h2>
      <p><b>Sesión:</b> ${sessionId}</p>
      <p><b>Correo del deportista:</b> ${emailUser || '(no proporcionado)'}</p>
      <hr/>
      ${body}
      <hr/>
      <p><i>Fin del resumen automático - VELOXTREM</i></p>
    `;

    await transporter.sendMail({
      from: `"SALVA.COACH" <${process.env.SMTP_USER}>`,
      to: ADMIN_EMAIL,
      subject: `💬 Nuevo contacto - SALVA.COACH (${emailUser || 'sin correo'})`,
      html
    });

    console.log(`📨 Resumen enviado a ${ADMIN_EMAIL}`);
  } catch (err) {
    console.error('❌ Error enviando correo resumen:', err.message);
  }
}

// ===== API principal =====
app.post('/api/chat', async (req, res) => {
  try {
    const text = (req.body?.message || '').trim().slice(0, 4000);
    const sessionId = (req.body?.session || '').toString().slice(0, 100);
    if (!text) return res.json({ reply: '¿En qué puedo ayudarte? 🙂' });

    const lang = (req.query.lang || 'es').startsWith('en') ? 'en' : 'es';
    const prefix = lang === 'en' ? 'Answer in English. ' : 'Responde en español. ';

    const state = getSession(sessionId);
    state.history = trimHistory(state.history);

    // Detectar correo
    const emailFound = detectEmail(text);
    if (emailFound && !state.email) {
      state.email = emailFound;
      state.summarySent = false;
    }

    // Anti-bucle
    const ANTI_LOOP = state.packsRecommended
      ? 'Nota: ya se han recomendado packs, no los repitas. Avanza y pide email si no lo tienes.'
      : 'Puedes recomendar los packs principales una vez y luego avanzar.';

    // Mensajes a OpenAI
    const messages = [
      { role: 'system', content: SALVA_PROMPT + '\n' + ANTI_LOOP },
      ...state.history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: prefix + text }
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.7,
      top_p: 0.9,
      messages
    });

    const reply = completion.choices[0].message.content.trim();

    // Detecta si recomendó packs
    if (/pack\s*(1\s*a\s*1|uno\s*a\s*uno)|premium/i.test(reply)) {
      state.packsRecommended = true;
    }

    // Guarda historial
    state.history.push({ role: 'user', content: text });
    state.history.push({ role: 'assistant', content: reply });
    state.history = trimHistory(state.history);

    // Si hay correo y no se envió aún, envía resumen
    if (state.email && !state.summarySent) {
      state.summarySent = true;
      sendSummaryEmail(sessionId, state.email, state.history);
    }

    res.json({ reply });
  } catch (err) {
    console.error('❌ Error /api/chat:', err.message);
    res.status(500).json({ error: 'chat_error', detail: err.message });
  }
});

// ===== Otros endpoints =====
app.get('/health', (_req, res) => res.send('ok'));
app.get('/', (_req, res) => res.send('✅ SALVA.COACH funcionando'));
app.get('/env-check', (_req, res) =>
  res.json({ ok: true, model: MODEL, adminEmail: ADMIN_EMAIL })
);

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor activo en puerto ${PORT}`);
});