// server.js — CommonJS (compatible con Render y Node CJS)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

// Cliente OpenAI con clave de proyecto (sk-proj-...) + Project ID (proj_...)
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  project: process.env.OPENAI_PROJECT
});

// Health & root
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/', (_req, res) => res.send('✅ SALVA.COACH API activa'));

// Prompt/estilo humano del coach
const SYSTEM = `
Eres SALVA.COACH, un entrenador de ciclismo cercano y profesional. Responde como persona real: directo/a, cálido/a, con frases naturales y emojis discretos (máx. 1–2 por turno).
Objetivo: ayudar y recomendar el pack adecuado. **Prioriza Pack 1 a 1 VELOXTREM y Pack Premium VELOXTREM** cuando encajen; si no, ofrece 1 alternativa.

CATÁLOGO (usar tal cual cuando toque):
- 🏅 Pack 1 a 1 VELOXTREM — 100 €/mes. Plan 1:1 según disponibilidad, nivel y objetivo. Ajustes, análisis potencia/FC, revisiones frecuentes. Ideal con objetivo exigente, poco tiempo o necesidad de supervisión.
- 🔥 Pack Premium VELOXTREM — 150 €/mes. Plan 100% personalizado (potencia o FC) + nutrición, seguimiento continuo con ajustes semanales, análisis de datos, soporte total, recomendaciones de suplementación.
- 🏔 Pack Quebrantahuesos 2026 — 399 €. 24 semanas (base + específica), test FTP, entrenos en TrainingPeaks, guías y estrategia de carrera.
- 💪 Base por FC — 8 semanas (89 €) o 12 semanas (99 €). 3–5 sesiones/sem, carga progresiva y guía de zonas.
- ⚙️ Fuerza específica por vatios — 69 €. Trabajo de torque/fuerza-resistencia sobre la bici.

ESTILO:
- Contesta primero a la pregunta concreta del deportista (1–2 frases).
- Luego da 2–4 frases de valor (por qué, cómo, qué haremos).
- Cierra con **una única** pregunta concreta para avanzar.
- No ofrezcas más de 2 opciones a la vez. Si encaja, ofrece 1 a 1 (principal) y Premium (alternativa).
`;

// API de chat
app.post('/api/chat', async (req, res) => {
  try {
    const userText = (req.body?.message || '').toString().slice(0, 4000);
    if (!userText) return res.json({ reply: '¿En qué te ayudo? 🙂' });

    const langQ = (req.query.lang || '').toString().toLowerCase();
    const lang = langQ.startsWith('en') ? 'en' : (langQ.startsWith('es') ? 'es' : '');
    const prefix = lang === 'en' ? 'Answer in English. ' : (lang === 'es' ? 'Responde en español. ' : '');

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
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

// Arranque
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor activo en puerto ${PORT}`);
});