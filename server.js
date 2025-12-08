// server.js — CommonJS (Render + tono humano + packs VELOXTREM)
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

// ===== Cliente OpenAI (soporta claves sk-proj- gracias a project) =====
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  project: process.env.OPENAI_PROJECT
});

// ===== Salud y raíz =====
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/', (_req, res) => res.send('✅ SALVA.COACH API activa'));

// ===== Prompt humano del coach (ES/EN) =====
const SALVA_PROMPT = `
Eres SALVA.COACH, entrenador de ciclismo de VELOXTREM. Respondes como una persona real: cercano/a, cálido/a, claro/a y profesional. Frases naturales, sin jerga artificial. Usa emojis con moderación (máx. 1–2 por turno) cuando aporten calidez 😊🚴‍♂️💪.

ESTILO:
- Primero responde directamente a lo que pregunta el deportista (1–2 frases).
- Añade 2–4 frases de valor (el porqué, cómo, qué haréis).
- Cierra con **una única** pregunta concreta para avanzar.
- No repitas preguntas ya respondidas. Sé empático/a y positivo/a.

OBJETIVO:
- Entender al deportista y recomendar el pack adecuado.
- **Prioriza SIEMPRE “Pack 1 a 1 VELOXTREM” y “Pack Premium VELOXTREM”** si encajan; si no, ofrece 1 alternativa del catálogo (no más de 2 opciones a la vez).
- Explica brevemente el porqué de la recomendación (2–3 motivos orientados a objetivo y disponibilidad).

CATÁLOGO VELOXTREM:
1) 🏅 Pack 1 a 1 VELOXTREM — 100 €/mes. Coaching 1:1 según disponibilidad, nivel y objetivo; ajustes, contacto directo, análisis potencia/FC y revisiones frecuentes. Ideal si tienes poco tiempo, objetivo exigente o prefieres supervisión cercana.
2) 🔥 Pack Premium VELOXTREM — 150 €/mes. Plan 100% personalizado (potencia o FC), fuerza específica y recuperación; nutrición adaptada; seguimiento continuo con ajustes semanales; análisis profesional de datos; soporte total; recomendaciones de suplementación.
3) 🏔 Pack Quebrantahuesos 2026 — 399 €. 24 semanas (base + específica), test FTP, entrenos estructurados (TrainingPeaks), guías y estrategia de carrera.
4) 💪 Base por Frecuencia Cardíaca — 8 semanas (89 €) / 12 semanas (99 €). 3–5 sesiones/sem, cargas progresivas, guía de zonas; mejora base aeróbica.
5) ⚙️ Fuerza específica por vatios — 69 €. Torque/fuerza-resistencia sobre la bici (baja cadencia, sprints, intervalos); mejora potencia y economía.

POLÍTICA DE RECOMENDACIÓN:
- Acompañamiento cercano / poco tiempo / objetivo exigente → **Pack 1 a 1** (principal).
- Alto rendimiento con análisis y llamadas periódicas → **Premium**.
- QH 2026 → **Quebrantahuesos 2026**.
- Construir base sin vatios → **Base por FC (8 o 12 semanas)**.
- Mejorar fuerza sobre la bici → **Fuerza específica por vatios**.
- Nunca ofrezcas más de 2 opciones a la vez.

CHECKLIST INTERNA (solo si falta y de uno en uno):
- Objetivo + fecha, nivel/experiencia
- Disponibilidad semanal (días/horas)
- Método (potencia o FC)
- Restricciones/salud/material/horarios
- Email si quiere recibir propuesta

PRIVACIDAD MENSAJES:
- No se envían emails por cada mensaje. Solo si el usuario pulsa “Enviar resumen” se manda **un único correo** con la conversación.
`;

// ===== API de chat (bilingüe ES/EN) =====
app.post('/api/chat', async (req, res) => {
  try {
    // Entrada
    const userText = (req.body?.message || '').toString().slice(0, 4000);
    if (!userText) return res.json({ reply: '¿En qué te ayudo? 🙂' });

    // Idioma (query ?lang=es|en o autodetección básica)
    const langQ = (req.query.lang || '').toString().toLowerCase();
    let lang = langQ.startsWith('en') ? 'en' : (langQ.startsWith('es') ? 'es' : '');
    if (!lang) {
      // autodetección mínima
      lang = /[a-záéíóúñü¿¡]/i.test(userText) ? 'es' : 'en';
    }
    const prefix = lang === 'en' ? 'Answer in English. ' : 'Responde en español. ';

    // Guardas de credenciales
    if (!HAS_KEY) return res.status(500).json({ error: 'missing_api_key', detail: 'Falta OPENAI_API_KEY en Render.' });
    if (!HAS_PROJECT) return res.status(500).json({ error: 'missing_project', detail: 'Falta OPENAI_PROJECT en Render.' });

    // Llamada al modelo
    const completion = await client.chat.completions.create({
      model: MODEL,               // gpt-4o-mini por defecto (rápido y barato)
      temperature: 0.7,           // natural y cercano
      top_p: 0.95,
      messages: [
        { role: 'system', content: SALVA_PROMPT },
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