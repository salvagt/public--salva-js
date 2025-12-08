// =======================
// SALVA.COACH - Servidor básico (CommonJS) con /notify
// =======================
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const path = require('path');
const nodemailer = require('nodemailer');

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Rutas visibles ----
app.get('/health', (req, res) => {
  res.status(200).send('✅ Servidor está funcionando correctamente.');
});

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <meta charset="utf-8">
        <title>SALVA.COACH</title>
        <style>
          body{font-family:system-ui,Arial;margin:40px;background:#f8fbfd}
          h1{color:#0078d7} a{color:#0078d7}
          .card{margin-top:14px;padding:12px 16px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;max-width:780px}
        </style>
      </head>
      <body>
        <h1>✅ SALVA.COACH en marcha</h1>
        <p>Servidor está funcionando. Prueba también <a href="/health">/health</a>.</p>
        <div class="card">
          Debajo dejaremos el chat incrustado cuando toque (multidioma y móvil).
        </div>
      </body>
    </html>
  `);
});

// Página limpia del widget (para el iframe del botón)
app.get('/widget', (req, res) => {
  res.sendFile(path.join(__dirname, 'widget.html'));
});

// ---- Email: transporter ----
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false, // 465=true; 587/25=false
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Verificación opcional de conexión SMTP al iniciar
transporter.verify().then(() => {
  console.log('📮 SMTP listo para enviar');
}).catch(err => {
  console.warn('⚠️  SMTP no verificado (revisar .env):', err.message);
});

// ---- Ruta POST /notify (envía UN único email con el resumen) ----
app.post('/notify', async (req, res) => {
  try {
    const { email, resumen, recomendado, transcript } = req.body || {};
    if (!email || !resumen || !recomendado) {
      return res.status(400).json({ ok:false, error:'faltan campos: email/resumen/recomendado' });
    }

    // Construir cuerpo
    const texto = [
      'SALVA.COACH — Resumen de conversación',
      '',
      'Datos del deportista:',
      resumen,
      '',
      'Recomendación:',
      `- Pack: ${recomendado.nombre}`,
      `- Precio: ${recomendado.precio}`,
      `- Motivo: ${recomendado.why}`,
      '',
      'Conversación (cronológica):',
      ...(Array.isArray(transcript) ? transcript.map(t =>
        `${new Date(t.at).toISOString()} | ${t.who === 'mine' ? 'deportista' : 'SALVA'}: ${t.text}`
      ) : ['(sin transcript)']),
      '',
      '— Enviado automáticamente por SALVA.COACH'
    ].join('\n');

    const html = `
      <div style="font-family:system-ui,Segoe UI,Arial">
        <h2>SALVA.COACH — Resumen de conversación</h2>
        <h3>Datos del deportista</h3>
        <pre style="white-space:pre-wrap;background:#f7f7f8;padding:12px;border-radius:8px;border:1px solid #eee">${escapeHtml(resumen)}</pre>
        <h3>Recomendación</h3>
        <ul>
          <li><b>Pack:</b> ${escapeHtml(recomendado.nombre)}</li>
          <li><b>Precio:</b> ${escapeHtml(recomendado.precio)}</li>
          <li><b>Motivo:</b> ${escapeHtml(recomendado.why)}</li>
        </ul>
        <h3>Conversación</h3>
        <pre style="white-space:pre-wrap;background:#f7f7f8;padding:12px;border-radius:8px;border:1px solid #eee">${
          Array.isArray(transcript)
            ? transcript.map(t => `${new Date(t.at).toLocaleString()} | ${t.who === 'mine' ? 'deportista' : 'SALVA'}: ${escapeHtml(t.text)}`).join('\n')
            : '(sin transcript)'
        }</pre>
        <p style="color:#777">— Enviado automáticamente por SALVA.COACH</p>
      </div>
    `;

    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM || 'SALVA.COACH <no-reply@localhost>',
      to: process.env.NOTIFY_TO,                 // te llega a ti
      replyTo: email,                            // responder al deportista
      subject: `SALVA.COACH — Resumen de ${email}`,
      text: texto,
      html,
    });

    console.log('📧 Email enviado:', info.messageId);
    return res.json({ ok:true, id: info.messageId });
  } catch (e) {
    console.error('❌ Error enviando email:', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});

function escapeHtml(s=''){ return String(s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ---- Arranque ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 SALVA.COACH activo en http://localhost:${PORT}`);
});