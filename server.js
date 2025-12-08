// server.js — CommonJS (Render + diagnóstico env + tono humano)
require('dotenv').config({ override: false }); // no pisa variables de Render
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

// ===== Diagnóstico de variables (sin exponer valores) =====
const HAS_KEY = !!process.env.OPENAI_API_KEY;
const HAS_PROJECT = !!process.env.OPENAI_PROJECT;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
console.log('ENV CHECK =>', { HAS_KEY, HAS_PROJECT, MODEL });

// Ruta de diagnóstico (no revela secretos)
app.get('/env-check', (_req, res) => {
  res.json({
    ok: true,
    hasOpenAIKey: HAS_KEY,
    hasOpenAIProject: HAS_PROJECT,
    model: MODEL
  });
});

// ===== Cliente OpenAI con clave de proyecto =====
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  project: process.env.OPENAI_PROJECT
});

// ===== Health & root =====
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/', (_req, res) => res.send('✅ SALVA.COACH API activa'));

// ===== Prompt humano del coach =====
const SYSTEM = `
Eres SALVA.COACH, entrenador de ciclismo cercano y profesional. Respondes como persona real (tono cálido, directo, frases naturales) con 1–2 emojis como mucho.
Objetivo: ayudar y recomendar el pack adecuado. **Prioriza Pack 1 a 1 VELOXTREM y Pack Premium VELOXTREM**; si no encajan, ofrece 1 alternativa.

CATÁLOGO:
- 🏅 Pack 1 a 1 VELOXTREM — 100 €/mes. Plan 1:1 según disponibilidad, nivel y objetivo; ajustes y análisis potencia/FC.
- 🔥 Pack Premium VELOXTREM — 150 €/mes. Plan 100% personalizado + nutrición + seguimiento con ajustes semanales + análisis de datos.
- 🏔 QH 2026 — 399 € (24 semanas). Base + específica, test FTP, TrainingPeaks, guías y estrategia de carrera.
- 💪 Base por FC — 8 semanas (89 €) / 12 semanas (99 €). 3–5 sesiones/sem; carga progresiva; guía de zonas.
- ⚙️ Fuerza específica por vatios — 69 €. Torque/fuerza-resistencia sobre la bici.

ESTILO:
- Contesta primero a lo que preguntan (1–2 frases).
- Añade 2–4 frases de valor (por qué, cómo, qué haremos).
- Cierra con **una única** pregunta para avanzar.
- No ofrezcas más de 2 opciones; si encaja, 1 a 1 (principal) y Premium (alternativa).
`;

// ===== API de chat =====
app.post('/api/chat', async (req, res) => {
  try {
    const userText = (req.body?.message || '').toString().slice(0, 4000);
    if (!userText) return res.json({ reply: '¿En qué te ayudo? 🙂' });

    const langQ = (req.query.lang || '').toString().toLowerCase();
    const lang = langQ.startsWith('en') ? 'en' : (langQ.startsWith('es') ? 'es' : '');
    const prefix = lang === 'en' ? 'Answer in English. ' : (lang === 'es' ? 'Responde en español. ' : '');

    // Si faltan credenciales, devolvemos aviso útil en vez de romper
    if (!HAS_KEY) return res.status(500).json({ error: 'missing_api_key', detail: 'Falta OPENAI_API_KEY en Render.' });
    if (!HAS_PROJECT) return res.status(500).json({ error: 'missing_project', detail: 'Falta OPENAI_PROJECT en Render.' });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.8,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prefix + userText }
      ]
    });

    const reply = completion?.choices?.[0]?.message?.content?.trim?.() || '…';
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