// server.js — SALVA.COACH con memoria + anti-bucle + emails (staff y deportista)
require('dotenv').config({ override: false });
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ===== Config / ENV =====
const HAS_KEY = !!process.env.OPENAI_API_KEY;
const HAS_PROJECT = !!process.env.OPENAI_PROJECT;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'salva@veloxtrem.com';
const FROM_NAME = process.env.FROM_NAME || 'SALVA.COACH';
const BOOKING_URL = process.env.BOOKING_URL || ''; // opcional

console.log('ENV CHECK =>', {
  HAS_KEY,
  HAS_PROJECT,
  MODEL,
  ADMIN_EMAIL,
  HAS_SMTP: !!(SMTP_HOST && SMTP_USER && SMTP_PASS)
});

// ===== OpenAI client =====
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  project: process.env.OPENAI_PROJECT
});

// ===== Nodemailer transporter =====
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465, // true para 465
  auth: { user: SMTP_USER, pass: SMTP_PASS }
});

// ===== Endpoints de diagnóstico =====
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/env-check', (_req, res) => {
  res.json({
    ok: true,
    hasOpenAIKey: HAS_KEY,
    hasOpenAIProject: HAS_PROJECT,
    hasSMTP: !!(SMTP_HOST && SMTP_USER && SMTP_PASS),
    model: MODEL,
    adminEmail: ADMIN_EMAIL
  });
});
app.get('/', (_req, res) => res.send('✅ SALVA.COACH funcionando'));

// ===== Memoria por sesión (RAM) =====
/*
sessions: Map<sessionId, {
  history: {role:'user'|'assistant', content:string}[],
  packsRecommended: boolean,
  email: string|null,
  summarySent: boolean
}>
*/
const sessions = new Map();
function getSession(id) {
  if (!id) return null;
  if (!sessions.has(id)) {
    sessions.set(id, { history: [], packsRecommended: false, email: null, summarySent: false });
  }
  return sessions.get(id);
}
function trimHistory(arr, max = 15) {
  return arr.length > max ? arr.slice(arr.length - max) : arr;
}

// ===== Prompt humano =====
const SALVA_PROMPT = `
Eres SALVA.COACH, entrenador de ciclismo de VELOXTREM. Sé humano, cercano y profesional. Usa emojis solo cuando aporten calidez 😊🚴‍♂️💪.

FLUJO:
1) Saluda breve y pregunta objetivo, disponibilidad y nivel.
2) Recomienda 1–2 packs máximo (prioriza 1 a 1 y Premium) cuando toque. No repitas packs.
3) Si ya recomendaste, avanza: modo entrenador (técnica, estructura, fuerza, nutrición, descanso).
4) En buen momento, pide email para enviar propuesta o ofrece llamada breve.
5) Si ya tienes el email, confirma y sigue con pasos claros.

CATÁLOGO PRINCIPAL:
- 🏅 1 a 1 VELOXTREM — 100 €/mes.
- 🔥 Premium VELOXTREM — 150 €/mes.
OTROS:
- 🏔 QH 2026 — 399 € (24 semanas).
- 💪 Base por FC — 8 (89 €) / 12 semanas (99 €).
- ⚙️ Fuerza específica por vatios — 69 €.

REGLAS:
- Responde primero a la pregunta concreta del deportista.
- Da 2–4 frases de valor.
- Cierra con una sola pregunta para avanzar.
- No repitas lo ya dicho.
`;

// ===== Utilidades =====
function detectEmail(text) {
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
}

function renderHistoryHTML(history) {
  return history
    .map(h => `<p><b>${h.role === 'user' ? '👤 Deportista' : '🤖 SALVA'}</b>: ${h.content}</p>`)
    .join('');
}

function renderHistoryText(history, maxLines = 10) {
  const last = history.slice(-maxLines);
  return last
    .map(h => `${h.role === 'user' ? 'Deportista' : 'SALVA'}: ${h.content}`)
    .join('\n');
}

// ===== Emails =====
async function sendAdminSummary({ sessionId, emailUser, history }) {
  if (!transporter) return;
  const html = `
    <h2>Nuevo contacto desde SALVA.COACH</h2>
    <p><b>Sesión:</b> ${sessionId}</p>
    <p><b>Correo del deportista:</b> ${emailUser || '(no proporcionado)'}</p>
    <hr/>
    ${renderHistoryHTML(history)}
    <hr/>
    <p><i>Resumen automático – VELOXTREM</i></p>
  `;
  await transporter.sendMail({
    from: `"${FROM_NAME}" <${SMTP_USER}>`,
    to: ADMIN_EMAIL,
    subject: `💬 Nuevo contacto - SALVA.COACH (${emailUser || 'sin correo'})`,
    html
  });
}

async function sendUserReceipt({ emailUser, history, lang = 'es' }) {
  if (!transporter || !emailUser) return;
  const intro =
    lang === 'en'
      ? `Thanks for contacting SALVA.COACH! Here's a summary of our conversation. I’ll get back to you shortly.`
      : `¡Gracias por contactar con SALVA.COACH! Aquí tienes un resumen de nuestra conversación. Te escribiré en breve.`;
  const next =
    lang === 'en'
      ? `Next steps: I’ll review your info and propose a plan.`
      : `Siguientes pasos: revisaré tu info y te propondré un plan.`;
  const book =
    BOOKING_URL
      ? (lang === 'en'
          ? `If you prefer, book a quick call here: ${BOOKING_URL}`
          : `Si prefieres, agenda una llamada breve aquí: ${BOOKING_URL}`)
      : '';
  const privacy =
    lang === 'en'
      ? `Privacy: we only email a single summary when you request it.`
      : `Privacidad: sólo enviamos un único resumen cuando tú lo solicitas.`;

  const textSummary = renderHistoryText(history, 10);
  const html = `
    <p>${intro}</p>
    <pre style="background:#f6f7f9;padding:12px;border-radius:8px;white-space:pre-wrap;">${textSummary}</pre>
    <p>${next}</p>
    ${book ? `<p>${book}</p>` : ''}
    <p>${privacy}</p>
    <p>— ${FROM_NAME} · VELOXTREM</p>
  `;
  await transporter.sendMail({
    from: `"${FROM_NAME}" <${SMTP_USER}>`,
    to: emailUser,
    subject: (lang === 'en'
      ? 'Your SALVA.COACH summary'
      : 'Tu resumen de la conversación con SALVA.COACH'),
    html
  });
}

// ===== API chat (memoria + anti-bucle + emails) =====
app.post('/api/chat', async (req, res) => {
  try {
    const text = (req.body?.message || '').trim().slice(0, 4000);
    const sessionId = (req.body?.session || '').toString().slice(0, 100);
    if (!text) return res.json({ reply: '¿En qué puedo ayudarte? 🙂' });

    // Idioma
    const langQ = (req.query.lang || '').toString().toLowerCase();
    let lang = langQ.startsWith('en') ? 'en' : (langQ.startsWith('es') ? 'es' : '');
    if (!lang) lang = /[a-záéíóúñü¿¡]/i.test(text) ? 'es' : 'en';
    const prefix = lang === 'en' ? 'Answer in English. ' : 'Responde en español. ';

    // Credenciales
    if (!HAS_KEY) return res.status(500).json({ error: 'missing_api_key', detail: 'Falta OPENAI_API_KEY' });
    if (!HAS_PROJECT) return res.status(500).json({ error: 'missing_project', detail: 'Falta OPENAI_PROJECT' });

    // Sesión
    const state = getSession(sessionId);
    state.history = trimHistory(state.history);

    // Detectar correo
    const emailFound = detectEmail(text);
    if (emailFound && !state.email) {
      state.email = emailFound;
      state.summarySent = false;
    }

    // Anti-bucle dinámico
    const ANTI_LOOP = state.packsRecommended
      ? (lang === 'en'
        ? 'Note: packs already recommended; do not repeat them unless asked. Advance naturally: coach mode, next steps, ask for email or propose a short call.'
        : 'Nota: ya se recomendaron packs; no los repitas salvo que te lo pidan. Avanza de forma natural: modo entrenador, siguientes pasos, pide email o propone llamada breve.')
      : (lang === 'en'
        ? 'If you recommend packs, do it once (1–2). After that, do not repeat.'
        : 'Si recomiendas packs, hazlo una vez (1–2). Después, no repitas.');

    // Mensajes a OpenAI (memoria corta)
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

    // Marcar recomendación de packs si procede
    if (/pack\s*(1\s*a\s*1|uno\s*a\s*uno)|premium|quebrantahuesos|base\s*por|fuerza\s*espec/i.test(reply)) {
      state.packsRecommended = true;
    }

    // Guardar historial
    state.history.push({ role: 'user', content: text });
    state.history.push({ role: 'assistant', content: reply });
    state.history = trimHistory(state.history);

    // Envío de emails (una sola vez por sesión, cuando haya email)
    if (state.email && !state.summarySent && transporter) {
      state.summarySent = true;
      // Enviar al staff y al deportista (no bloquear respuesta)
      sendAdminSummary({ sessionId, emailUser: state.email, history: state.history }).catch(()=>{});
      sendUserReceipt({ emailUser: state.email, history: state.history, lang }).catch(()=>{});
    }

    res.json({ reply });
  } catch (err) {
    console.error('❌ Error /api/chat:', err?.message || err);
    res.status(500).json({ error: 'chat_error', detail: String(err?.message || err) });
  }
});
// ===== Test rápido de correo =====
// Verifica el transporte al arrancar (opcional, pero útil)
if (transporter && transporter.verify) {
  transporter.verify().then(() => {
    console.log('📨 SMTP listo para enviar');
  }).catch(err => {
    console.error('❌ SMTP verify error:', err?.message || err);
  });
}

// GET /email-test?to=correo@dominio.com&user=1
// - Si añades &user=1 también envía al deportista, simulando el correo de cortesía.
app.get('/email-test', async (req, res) => {
  try {
    const to = (req.query.to || '').toString().trim();
    if (!to) return res.status(400).json({ ok: false, error: 'Falta ?to=correo@dominio' });

    // Mensaje simple al staff (ADMIN_EMAIL)
    const staffInfo = await transporter.sendMail({
      from: `"${FROM_NAME}" <${SMTP_USER}>`,
      to: ADMIN_EMAIL,
      subject: 'Test SALVA.COACH (staff)',
      html: `<p>Funciona el envío al staff ✅</p><p>Destino staff: ${ADMIN_EMAIL}</p>`
    });

    let userInfo = null;
    if (String(req.query.user || '') === '1') {
      userInfo = await transporter.sendMail({
        from: `"${FROM_NAME}" <${SMTP_USER}>`,
        to,
        subject: 'Test SALVA.COACH (usuario)',
        html: `<p>Hola 👋 Este es un test de correo de cortesía para el deportista.</p><p>Destino usuario: ${to}</p>`
      });
    }

    console.log('📨 Test staff response:', staffInfo?.response);
    if (userInfo) console.log('📨 Test user response:', userInfo?.response);

    res.json({
      ok: true,
      staff: { envelope: staffInfo?.envelope, response: staffInfo?.response },
      user: userInfo ? { envelope: userInfo?.envelope, response: userInfo?.response } : null
    });
  } catch (err) {
    console.error('❌ /email-test error:', err?.message || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});
// ===== Arranque =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor activo en puerto ${PORT}`);
});