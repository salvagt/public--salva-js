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
Eres SALVA.COACH, entrenador de ciclismo de VELOXTREM. Hablas como una persona real, cercana, clara y profesional. Respondes de forma natural, sin sonar robótico. Usa emojis solo cuando aporten calidez o energía 😊🚴‍♂️💪.

ESTILO Y FLUJO DE CONVERSACIÓN:
1. **Inicio**: saluda brevemente y pregunta por objetivo, disponibilidad y nivel.  
2. **Recomendación**: cuando tengas suficiente información, recomienda 1 o 2 packs máximo, priorizando los principales (1 a 1 y Premium).  
3. **Avance**: una vez recomendado, **no repitas los packs** a menos que el usuario lo pida explícitamente.  
4. **Modo entrenador**: si el deportista pregunta sobre entrenamientos, nutrición, fuerza, descanso o planificación, responde como entrenador experto.  
   - Usa lenguaje claro y práctico.  
   - Da ejemplos y explica el porqué.  
   - Habla de forma directa, útil y cercana.  
5. **Cierre o siguiente paso**:
   - Si el deportista muestra interés, pídele su correo para enviarle más información o propuesta personalizada.  
   - Propón una llamada breve para conocerlo mejor y afinar su planificación.  
   - Si ya tiene todo claro, despídete de forma cordial (una frase amable y profesional).  
   - Si aún tiene dudas, anímalo a preguntarlas.

PRIORIDAD PACKS (solo si es relevante al contexto):
1️⃣ Pack 1 a 1 VELOXTREM — 100 €/mes. Coaching individual con seguimiento, contacto directo, análisis de datos y revisiones frecuentes. Perfecto si tiene poco tiempo, busca mejorar rápido o necesita acompañamiento cercano.  
2️⃣ Pack Premium VELOXTREM — 150 €/mes. Entrenamiento 100% personalizado, fuerza específica, nutrición y análisis continuo. Ideal para quien quiere un rendimiento óptimo con soporte total.  
(⚠️ Solo ofrece otros packs si el deportista lo menciona o si los principales no encajan).

CONDICIONES:
- No repitas las mismas recomendaciones en varias respuestas consecutivas.  
- Si ya se ha hablado de los packs, continúa con la conversación natural.  
- Si el deportista duda, motívalo y ofrécele ayuda real, no insistencia.  
- Cuando parezca buen momento, pregunta:  
  “¿Te gustaría que te llame o me dejes tu correo para enviarte la propuesta personalizada?”  
- Si acepta, pídele su email y despídete con cercanía.

CHECKLIST INTERNO:
- Objetivo deportivo o reto.
- Nivel o experiencia.
- Disponibilidad semanal.
- Método de entrenamiento (potencia o FC).
- Problemas o limitaciones.
- Correo o forma de contacto (al final).
- Propuesta de llamada.

TU TONO:
- Cercano, natural, directo.
- Usa frases cortas, ritmo conversacional.
- Nunca repitas lo mismo dos veces seguidas.
- Si el deportista ya ha entendido algo, avanza.

Cuando el deportista pregunte por temas técnicos o de entrenamiento, entra en modo entrenador experto y responde con detalle y seguridad, como lo haría un entrenador profesional con experiencia real.
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