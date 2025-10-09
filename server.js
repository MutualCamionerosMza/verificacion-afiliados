// server.js (reemplazar)

if (process.env.NODE_ENV !== 'production') require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const csv = require('csv-parser');

const app = express();
const PORT = process.env.PORT || 8080;

// --- CORS: orígenes permitidos (ajustá si necesitás más)
const allowedOrigins = [
  'https://evamendezs.github.io',
  'https://mutualcamionerosmza.github.io'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // permite herramientas / mobile apps / curl sin origen
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS no permitido para el origen: ' + origin), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-admin-pin']
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- Conexión a Postgres (Pool) ---
// Preferir DATABASE_URL (estándar). Mantener compatibilidad con PG_CONNECTION_STRING.
const CONNECTION_STRING = process.env.DATABASE_URL || process.env.PG_CONNECTION_STRING;
if (!CONNECTION_STRING) {
  console.error("❌ ERROR: La variable de entorno DATABASE_URL o PG_CONNECTION_STRING no está definida.");
  process.exit(1);
}

// SSL handling: muchos hosts gestionados (Railway/Heroku) requieren ssl with rejectUnauthorized false.
const poolOptions = {
  connectionString: CONNECTION_STRING,
};

// habilitar SSL si estamos en producción o si la connection string incluye cloud/remote host
if (process.env.NODE_ENV === 'production' || /postgres.*amazonaws|railway|heroku/i.test(CONNECTION_STRING)) {
  poolOptions.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolOptions);

pool.on('error', (err) => {
  console.error('Unexpected PG pool error', err);
  process.exit(-1);
});

// --- Funciones DB / Inicialización ---
async function conectarEInicializar() {
  try {
    await pool.query('SELECT 1'); // prueba simple de conexión
    console.log('✅ Conectado a PostgreSQL (pool)');
  } catch (err) {
    console.error('❌ Error conectando a PostgreSQL:', err.message || err);
    throw err;
  }

  // crear tablas si no existen
  await pool.query(`
    CREATE TABLE IF NOT EXISTS afiliados (
      id SERIAL PRIMARY KEY,
      nro_afiliado TEXT UNIQUE,
      nombre_completo TEXT NOT NULL,
      dni TEXT UNIQUE NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      accion TEXT,
      dni TEXT,
      nombre_completo TEXT,
      nro_afiliado TEXT,
      fecha TIMESTAMP DEFAULT now()
    );
  `);

  // si la tabla afiliados está vacía, intentar importar CSV si existe
  const { rows } = await pool.query('SELECT COUNT(*) FROM afiliados');
  if (parseInt(rows[0].count, 10) === 0) {
    const csvPath = path.resolve(__dirname, 'afiliados.csv');
    if (fs.existsSync(csvPath)) {
      console.log('La tabla afiliados está vacía. Importando desde CSV...');
      await importarCSV();
    } else {
      console.log('La tabla afiliados está vacía y no se encontró afiliados.csv — OK, continuar.');
    }
  } else {
    console.log('La tabla afiliados ya tiene datos.');
  }
}

async function importarCSV() {
  return new Promise((resolve, reject) => {
    const filas = [];
    const csvPath = path.resolve(__dirname, 'afiliados.csv');
    if (!fs.existsSync(csvPath)) {
      console.warn('No se encontró afiliados.csv para importar.');
      return resolve();
    }

    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('data', (data) => {
        // Intentamos soportar archivos con cabeceras: nro_afiliado,nombre_completo,dni
        const nro = (data.nro_afiliado || data['0'] || data['nro'] || '').toString().trim();
        const nombre = (data.nombre_completo || data['1'] || data['nombre'] || '').toString().trim();
        const dni = (data.dni || data['2'] || data['dni'] || '').toString().trim();
        if (nro && nombre && dni) {
          filas.push({ nro_afiliado: nro, nombre_completo: nombre, dni });
        }
      })
      .on('end', async () => {
        try {
          if (filas.length === 0) {
            console.log('CSV leído pero no se encontraron filas válidas.');
            return resolve();
          }

          // Insertar en batch con transacción
          await pool.query('BEGIN');
          const insertText = `INSERT INTO afiliados (nro_afiliado, nombre_completo, dni) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`;
          for (const f of filas) {
            await pool.query(insertText, [f.nro_afiliado, f.nombre_completo, f.dni]);
          }
          await pool.query('COMMIT');
          console.log(`✅ Importados ${filas.length} afiliados desde CSV`);
          resolve();
        } catch (err) {
          await pool.query('ROLLBACK').catch(()=>{});
          console.error('❌ Error importando CSV:', err.message || err);
          reject(err);
        }
      })
      .on('error', (error) => {
        console.error('❌ Error leyendo CSV:', error.message || error);
        reject(error);
      });
  });
}

// --- Utilidades ---
const ADMIN_PIN = process.env.ADMIN_PIN || '1906'; // opcionalmente setear por env
function validarPin(req, res, next) {
  const pin = req.headers['x-admin-pin'] || req.body.pin || req.query.pin;
  if (pin === ADMIN_PIN) return next();
  return res.status(403).json({ error: 'PIN inválido' });
}
function esNumero(str) { return /^\d+$/.test(String(str).trim()); }

// === RUTAS ===
app.post('/verificar', async (req, res) => {
  const { dni } = req.body;
  if (!dni || !esNumero(dni)) return res.status(400).json({ error: 'DNI inválido' });
  try {
    const result = await pool.query('SELECT nro_afiliado, nombre_completo, dni FROM afiliados WHERE dni = $1', [dni.trim()]);
    return res.json(result.rows.length > 0 ? { afiliado: true, datos: result.rows[0] } : { afiliado: false });
  } catch (err) {
    console.error('/verificar error:', err);
    return res.status(500).json({ error: 'Error en la base de datos' });
  }
});

// Generación de PDF: POST (form) y GET (para iPhone/browser)
async function generarPdfBuffer(row) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([400, 300]);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const blue = rgb(0, 0.3, 0.6);
  const fecha = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false });

  page.drawText('ASOCIACIÓN MUTUAL CAMIONEROS DE MENDOZA', { x: 20, y: 260, size: 14, font, color: blue });
  page.drawText(`Nombre: ${row.nombre_completo}`, { x: 20, y: 230, size: 12, font, color: blue });
  page.drawText(`DNI: ${row.dni}`, { x: 20, y: 210, size: 12, font, color: blue });
  page.drawText(`N° Afiliado: ${row.nro_afiliado}`, { x: 20, y: 190, size: 12, font, color: blue });
  page.drawText(`Fecha de solicitud: ${fecha}`, { x: 20, y: 170, size: 10, font, color: blue });

  try {
    const logoPath = path.resolve(__dirname, 'assets', 'LogoMutual.png');
    if (fs.existsSync(logoPath)) {
      const logoImage = await pdfDoc.embedPng(fs.readFileSync(logoPath));
      page.drawImage(logoImage, { x: 75, y: 0, width: 250, height: 200 });
    } else {
      console.warn('Logo no encontrado en assets/LogoMutual.png — se genera PDF sin logo.');
    }
  } catch (err) {
    console.warn('Error embed logo:', err.message || err);
  }

  return pdfDoc.save();
}

app.post('/credencial', async (req, res) => {
  const { dni } = req.body;
  if (!dni || !esNumero(dni)) return res.status(400).json({ error: 'DNI inválido' });
  try {
    const result = await pool.query('SELECT * FROM afiliados WHERE dni = $1', [dni.trim()]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Afiliado no encontrado' });
    const pdfBytes = await generarPdfBuffer(result.rows[0]);
    res.setHeader('Content-Type', 'application/pdf');
    // POST: sugerimos descarga
    res.setHeader('Content-Disposition', 'attachment; filename="credencial.pdf"');
    return res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('/credencial POST error:', error);
    return res.status(500).json({ error: 'Error generando el PDF' });
  }
});

// GET para credencial (compatible iPhone/safari): /credencial?dni=...
app.get('/credencial', async (req, res) => {
  const { dni } = req.query;
  if (!dni || !esNumero(dni)) return res.status(400).json({ error: 'DNI inválido' });
  try {
    const result = await pool.query('SELECT * FROM afiliados WHERE dni = $1', [dni.trim()]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Afiliado no encontrado' });
    const pdfBytes = await generarPdfBuffer(result.rows[0]);
    res.setHeader('Content-Type', 'application/pdf');
    // inline para que iOS abra en el navegador/visor
    res.setHeader('Content-Disposition', 'inline; filename="credencial.pdf"');
    return res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('/credencial GET error:', error);
    return res.status(500).json({ error: 'Error generando el PDF' });
  }
});

// Admin: cargar, editar, eliminar
app.post('/admin/cargar-afiliados', validarPin, async (req, res) => {
  let { nro_afiliado, nombre_completo, dni } = req.body;
  if (!nro_afiliado || !nombre_completo || !dni) return res.status(400).json({ error: 'Faltan datos' });

  nro_afiliado = nro_afiliado.trim();
  nombre_completo = nombre_completo.trim();
  dni = dni.trim();

  if (!esNumero(dni)) return res.status(400).json({ error: 'DNI inválido' });
  if (!esNumero(nro_afiliado)) return res.status(400).json({ error: 'N° Afiliado inválido' });

  try {
    const dniExiste = await pool.query('SELECT 1 FROM afiliados WHERE dni = $1', [dni]);
    if (dniExiste.rowCount > 0) return res.status(409).json({ error: 'El DNI ya existe' });

    const nroExiste = await pool.query('SELECT 1 FROM afiliados WHERE nro_afiliado = $1', [nro_afiliado]);
    if (nroExiste.rowCount > 0) return res.status(409).json({ error: 'El N° Afiliado ya existe' });

    await pool.query('INSERT INTO afiliados (nro_afiliado, nombre_completo, dni) VALUES ($1, $2, $3)', [nro_afiliado, nombre_completo, dni]);

    await pool.query(
      'INSERT INTO logs (accion, dni, nombre_completo, nro_afiliado) VALUES ($1, $2, $3, $4)',
      ['Agregar', dni, nombre_completo, nro_afiliado]
    );

    return res.json({ success: true, message: 'Afiliado agregado' });
  } catch (err) {
    console.error('/admin/cargar-afiliados error:', err);
    return res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.put('/admin/editar-afiliado', validarPin, async (req, res) => {
  let { nro_afiliado, nombre_completo, dni } = req.body;
  if (!nro_afiliado || !nombre_completo || !dni) return res.status(400).json({ error: 'Faltan datos' });

  nro_afiliado = nro_afiliado.trim();
  nombre_completo = nombre_completo.trim();
  dni = dni.trim();

  try {
    const result = await pool.query(
      'UPDATE afiliados SET nro_afiliado = $1, nombre_completo = $2 WHERE dni = $3',
      [nro_afiliado, nombre_completo, dni]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Afiliado no encontrado' });

    await pool.query(
      'INSERT INTO logs (accion, dni, nombre_completo, nro_afiliado) VALUES ($1, $2, $3, $4)',
      ['Editar', dni, nombre_completo, nro_afiliado]
    );

    return res.json({ success: true, message: 'Afiliado modificado' });
  } catch (err) {
    console.error('/admin/editar-afiliado error:', err);
    return res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.post('/admin/eliminar-afiliado', validarPin, async (req, res) => {
  const { dni } = req.body;
  if (!dni) return res.status(400).json({ error: 'Falta el DNI' });

  try {
    const result = await pool.query('SELECT * FROM afiliados WHERE dni = $1', [dni.trim()]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Afiliado no encontrado' });

    const row = result.rows[0];
    await pool.query('DELETE FROM afiliados WHERE dni = $1', [dni.trim()]);

    await pool.query(
      'INSERT INTO logs (accion, dni, nombre_completo, nro_afiliado) VALUES ($1, $2, $3, $4)',
      ['Eliminar', row.dni, row.nombre_completo, row.nro_afiliado]
    );

    return res.json({ success: true, message: 'Afiliado eliminado' });
  } catch (err) {
    console.error('/admin/eliminar-afiliado error:', err);
    return res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.get('/admin/listar-logs', validarPin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM logs ORDER BY fecha DESC LIMIT 100');
    return res.json(result.rows);
  } catch (err) {
    console.error('/admin/listar-logs error:', err);
    return res.status(500).json({ error: 'Error al listar logs' });
  }
});

// --- LEVANTAR SERVER DESPUÉS DE INICIALIZAR DB ---
(async () => {
  try {
    await conectarEInicializar();
    app.listen(PORT, () => {
      console.log(`🚀 Servidor escuchando en http://localhost:${PORT} (PORT env: ${process.env.PORT || '8080'})`);
    });
  } catch (err) {
    console.error('No se pudo inicializar la aplicación:', err);
    process.exit(1);
  }
})();

// --- CIERRE LIMPIO ---
process.on('SIGINT', async () => {
  console.log('SIGINT recibido — cerrando pool de Postgres.');
  await pool.end().catch(()=>{});
  process.exit(0);
});
process.on('SIGTERM', async () => {
  console.log('SIGTERM recibido — cerrando pool de Postgres.');
  await pool.end().catch(()=>{});
  process.exit(0);
});
