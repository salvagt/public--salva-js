// server.js — CommonJS (Render + memoria por sesión + tono humano + anti-bucle)
require('dotenv').config({ override: false });
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ===== Diagnóstico ENV (no expone secretos) =====
const HAS_KEY = !!process.env.OPENAI_API_KEY;
const HAS_PROJECT = !!process.env.OPENAI_PROJECT;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
console.log('ENV CHECK =>', { HAS_KEY, HAS_PROJECT, MODEL });

app.get('/env-check', (_req, res) => {
  res.json({ ok: true, hasOpenAIKey: HAS_KEY, hasOpenAIProject: HAS_PROJECT, model: MODEL });
});

// ===== Cliente OpenAI (clave de proyecto + project ID) =====
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  project: process.env.OPENAI_PROJECT
});

// ===== Salud y raíz =====
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/', (_req, res) => res.send('✅ SALVA.COACH API activa'));

// ===== Memoria por sesión en RAM =====
/*
  sessions: Map<sessionId, {
    history: {role:'user'|'assistant', content:string}[],
    packsRecommended: boolean
  }>
*/
const sessions = new Map();
function getSession(sessionId) {
  if (!sessionId) return null;
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { history: [], packsRecommended: false });
  }
  return sessions.get(sessionId);
}
function trimHistory(arr, max = 12) {
  if (arr.length > max) return arr.slice(arr.length - max);
  return arr;
}

// ===== Prompt humano (con política de avances) =====
const SALVA_PROMPT_BASE = `
Eres SALVA.COACH, entrenador de ciclismo de VELOXTREM. Hablas como persona real, cercano/a, claro/a y profesional. Usa emojis solo si aportan calidez 😊🚴‍♂️💪.

ESTILO Y FLUJO:
1) Saluda breve y pregunta objetivo, disponibilidad y nivel.
2) Cuando tengas info, recomienda 1–2 packs máximo, priorizando 1 a 1 y Premium. **Hazlo solo una vez** salvo que te lo pidan.
3) Si ya se han recomendado packs, **no los repitas**; avanza: resuelve dudas, modo entrenador, plan de acción.
4) Modo entrenador: respuestas prácticas y claras, con ejemplos y porqués.
5) Cierre / siguiente paso: pide email para enviar propuesta o propone una llamada breve. Despide con cercanía si ya está todo claro.

CATÁLOGO (usar cuando toque):
- 🏅 Pack 1 a 1 VELOXTREM — 100 €/mes. Coaching 1:1, ajustes, contacto directo, análisis potencia/FC.
- 🔥 Premium VELOXTREM — 150 €/mes. 100% personalizado + nutrición + seguimiento y análisis continuo.
- 🏔 QH 2026 — 399 € (24 semanas).
- 💪 Base por FC — 8 semanas (89 €) / 12 semanas (99 €).
- ⚙️ Fuerza específica por vatios — 69 €.

POLÍTICA:
- Prioriza 1 a 1 / Premium si encajan; si no, ofrece 1 alternativa.
- **No repitas** packs en respuestas consecutivas; continúa la conversación natural.
- En buen momento pregunta: “¿Te paso propuesta por email o prefieres una llamada breve?”.
- Recoge email si acepta.
`;

// ===== API de chat (con memoria y anti-bucle) =====
app.post('/api/chat', async (req, res) => {
  try {
    const userText = (req.body?.message || '').toString().slice(0, 4000);
    const sessionId = (req.body?.session || '').toString().slice(0, 100);
    if (!userText) return res.json({ reply: '¿En qué te ayudo? 🙂' });

    // Idioma
    const langQ = (req.query.lang || '').toString().toLowerCase();
    let lang = langQ.startsWith('en') ? 'en' : (langQ.startsWith('es') ? 'es' : '');
    if (!lang) lang = /[a-záéíóúñü¿¡]/i.test(userText) ? 'es' : 'en';
    const prefix = lang === 'en' ? 'Answer in English. ' : 'Responde en español. ';

    // Guardas credenciales
    if (!HAS_KEY) return res.status(500).json({ error: 'missing_api_key', detail: 'Falta OPENAI_API_KEY en Render.' });
    if (!HAS_PROJECT) return res.status(500).json({ error: 'missing_project', detail: 'Falta OPENAI_PROJECT en Render.' });

    // Estado de sesión
    const state = getSession(sessionId) || { history: [], packsRecommended: false };
    state.history = trimHistory(state.history);

    // Instrucción dinámica anti-bucle
    const ANTI_LOOP = state.packsRecommended
      ? (lang === 'en'
        ? 'Note: Packs have already been recommended. Do not re-offer them unless explicitly asked. Keep advancing: coach mode, next steps, ask for email or offer a short call.'
        : 'Nota: ya se han recomendado packs. No los repitas salvo que te lo pidan. Avanza: modo entrenador, siguientes pasos, pide email o propone llamada breve.')
      : (lang === 'en'
        ? 'If you recommend packs, do it only once (1–2 options). After that, do not repeat. Keep a natural flow.'
        : 'Si recomiendas packs, hazlo una vez (1–2 opciones). Después, no repitas. Mantén flujo natural.');

    // Construye mensajes con memoria corta
    const messages = [
      { role: 'system', content: SALVA_PROMPT_BASE + '\n' + ANTI_LOOP },
      // historial breve
      ...state.history.map(m => ({ role: m.role, content: m.content })),
      // turno actual del usuario
      { role: 'user', content: prefix + userText }
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.7,
      top_p: 0.95,
      messages
    });

    const reply = completion?.choices?.[0]?.message?.content?.trim?.() || '…';

    // Actualiza flag si detecta recomendación de packs
    if (/pack\s*(1\s*a\s*1|uno\s*a\s*uno)|premium|quebrantahuesos|base\s*por|fuerza\s*espec/i.test(reply)) {
      state.packsRecommended = true;
    }

    // Actualiza memoria (capada)
    state.history.push({ role: 'user', content: userText });
    state.history.push({ role: 'assistant', content: reply });
    state.history = trimHistory(state.history);
    if (sessionId) sessions.set(sessionId, state);

    res.json({ reply });
  } catch (err) {
    console.error('❌ Error /api/chat:', err?.message || err);
    res.status(500).json({ error: 'chat_error', detail: String(err?.message || err) });
  }
});

// ===== Arranque =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor activo en puerto ${PORT}`);
});