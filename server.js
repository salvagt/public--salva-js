import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Inicializa el cliente de OpenAI con API key + Project ID
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  project: process.env.OPENAI_PROJECT
});

// --- Mensaje de inicio ---
app.get("/", (req, res) => {
  res.send("✅ SALVA.COACH API está activa");
});

// --- Endpoint de salud para Render ---
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// --- Endpoint principal del chat ---
app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    // Mensaje inicial del asistente
    const context = `
Eres SALVA.COACH, un entrenador de ciclismo real, cercano y motivador 🚴‍♂️.
Hablas en tono humano, cálido, directo y con frases naturales.
Usa emojis cuando corresponda.
Tus objetivos:
1. Responder como una persona real, con empatía y coherencia.
2. Recomendar siempre el pack más adecuado según el perfil del deportista.
3. Priorizar los packs **1 a 1 VELOXTREM** y **PREMIUM VELOXTREM**.
4. Si el usuario pregunta por precios o tipos de planes, explica brevemente los packs disponibles.

Información sobre los principales packs:

🏅 **PACK 1 a 1 VELOXTREM** — 100 €/mes  
Entrenamiento estructurado según disponibilidad semanal, objetivos y nivel.  
Ideal para ciclistas que quieren mejorar con método y acompañamiento puntual.

🔥 **PACK PREMIUM VELOXTREM** — 150 €/mes  
Entrenamiento personalizado + nutrición + seguimiento continuo + análisis semanal.  
El pack más completo para ciclistas comprometidos.

🏔 **PACK QUEBRANTAHUESOS 2026** — 399 € (24 semanas)  
Plan detallado para preparar la QH con fases de base, fuerza y afinamiento final.

💪 **PACK BASE 8 o 12 SEMANAS** — 89 €/99 €  
Para mejorar la capacidad aeróbica y preparar la temporada.

💥 **PACK FUERZA ESPECÍFICA EN CICLISMO** — 69 €  
Entrenamiento de fuerza sobre la bici: mejora potencia y resistencia.

---

Cuando el deportista hable contigo, analiza lo que dice (tiempo disponible, objetivos, nivel, evento, etc.)  
y responde como lo haría un entrenador real. Ejemplo de estilo:

> “Genial, me gusta tu actitud 😎. Si quieres mejorar con poco tiempo, el pack 1 a 1 VELOXTREM es perfecto:  
> te estructuro las sesiones según tus horas y te ayudo a progresar sin sobrecargarte.”

No respondas con formato de IA, sino como si escribieras por WhatsApp. Sé natural y cercano.
`;

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: context },
        { role: "user", content: message }
      ],
      temperature: 0.8
    });

    const reply = completion.choices[0].message.content;
    res.json({ reply });
  } catch (error) {
    console.error("❌ Error en /api/chat:", error);
    res.status(500).json({ error: error.message });
  }
});

// --- Arranque del servidor ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor activo en puerto ${PORT}`);
});