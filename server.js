import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// --- CORS ---
app.use(cors({
  origin: 'https://mutualcamionerosmza.github.io',
  methods: ['GET','POST','PUT','DELETE'],
  allowedHeaders: ['Content-Type', 'x-admin-pin']
}));

// --- Body parser ---
app.use(bodyParser.json());

// --- PostgreSQL ---
const pool = new Pool({
  connectionString: process.env.PG_CONNECTION_STRING,
  ssl: { rejectUnauthorized: false }
});

pool.connect()
  .then(() => console.log('✅ Conectado a PostgreSQL'))
  .catch(err => console.error('❌ Error al conectar con PostgreSQL:', err));

// --- Rutas ---
// Verificar afiliado
app.post('/verificar', async (req, res) => {
  const { dni } = req.body;
  try {
    const result = await pool.query('SELECT * FROM afiliados WHERE dni=$1', [dni]);
    if (result.rows.length > 0) {
      res.json({ afiliado: true, datos: result.rows[0] });
    } else {
      res.json({ afiliado: false });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

// --- Credencial premium ---
app.get('/credencial', async (req, res) => {
  const { dni } = req.query;
  if (!dni) return res.status(400).send('Falta el DNI');

  try {
    const result = await pool.query('SELECT * FROM afiliados WHERE dni=$1', [dni]);
    if (result.rows.length === 0) return res.status(404).send('No se encontró afiliado');

    const afiliado = result.rows[0];

    // Tamaño tarjeta: 85mm x 55mm
    const mmToPoints = mm => mm * 2.83465;
    const width = mmToPoints(85);
    const height = mmToPoints(55);

    const doc = new PDFDocument({ size: [width, height], margins: { top: 5, bottom: 5, left: 5, right: 5 } });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=credencial-${dni}.pdf`);
    doc.pipe(res);

    // Fondo degradado
    const gradientHeight = height;
    for (let i = 0; i < gradientHeight; i++) {
      const colorVal = Math.floor(230 - i * 0.8);
      doc.rect(0, i, width, 1).fill(`rgb(${colorVal},${colorVal},${colorVal})`);
    }

    // Bordes redondeados
    const radius = 10;
    doc.roundedRect(0, 0, width, height, radius).stroke('#003366');

    // Logo centrado y grande
    const logoPath = path.join(process.cwd(), 'assets', 'logo.png');
    if (fs.existsSync(logoPath)) {
      const logoWidth = width * 0.6;
      const logoHeight = height * 0.25;
      const logoX = (width - logoWidth) / 2;
      doc.image(logoPath, logoX, 5, { width: logoWidth, height: logoHeight });
    }

    // Título
    doc.fillColor('#003366')
       .font('Helvetica-Bold')
       .fontSize(10)
       .text('CREDENCIAL DE AFILIADO', 0, height * 0.32, { align: 'center' });

    // Datos del afiliado
    doc.moveDown(0.3)
       .font('Helvetica')
       .fontSize(8.5)
       .fillColor('black')
       .text(`Nombre: ${afiliado.nombre_completo}`, { align: 'center' })
       .text(`DNI: ${afiliado.dni}`, { align: 'center' })
       .text(`N° Afiliado: ${afiliado.nro_afiliado}`, { align: 'center' });

    // Fecha y hora 24 hs
    const fecha = new Date();
    const fechaStr = fecha.toLocaleDateString('es-AR') + ' ' +
                     fecha.getHours().toString().padStart(2, '0') + ':' +
                     fecha.getMinutes().toString().padStart(2, '0');
    doc.moveDown(0.3)
       .fontSize(7)
       .fillColor('#555555')
       .text(`Emitido: ${fechaStr}`, { align: 'center' });

    doc.end();

  } catch (error) {
    console.error('Error generando credencial:', error);
    res.status(500).send('Error generando credencial');
  }
});

// --- Admin ---
const ADMIN_PIN = '1906';
function validarPin(req, res, next) {
  const pin = req.headers['x-admin-pin'];
  if (pin === ADMIN_PIN) return next();
  return res.status(403).json({ error: 'PIN incorrecto' });
}

// Agregar afiliado
app.post('/admin/cargar-afiliados', validarPin, async (req, res) => {
  const { dni, nombre_completo, nro_afiliado } = req.body;
  try {
    await pool.query(
      'INSERT INTO afiliados (dni, nombre_completo, nro_afiliado) VALUES ($1,$2,$3)',
      [dni, nombre_completo, nro_afiliado]
    );
    await pool.query(
      'INSERT INTO logs (accion, dni, nombre_completo, nro_afiliado, fecha) VALUES ($1,$2,$3,$4,NOW())',
      ['Agregar', dni, nombre_completo, nro_afiliado]
    );
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.json({ success: false, error: 'Error al agregar afiliado' });
  }
});

// Editar afiliado
app.put('/admin/editar-afiliado', validarPin, async (req, res) => {
  const { dni, nombre_completo, nro_afiliado } = req.body;
  try {
    await pool.query(
      'UPDATE afiliados SET nombre_completo=$1, nro_afiliado=$2 WHERE dni=$3',
      [nombre_completo, nro_afiliado, dni]
    );
    await pool.query(
      'INSERT INTO logs (accion, dni, nombre_completo, nro_afiliado, fecha) VALUES ($1,$2,$3,$4,NOW())',
      ['Editar', dni, nombre_completo, nro_afiliado]
    );
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.json({ success: false, error: 'Error al editar afiliado' });
  }
});

// Eliminar afiliado
app.post('/admin/eliminar-afiliado', validarPin, async (req, res) => {
  const { dni } = req.body;
  try {
    const result = await pool.query('SELECT * FROM afiliados WHERE dni=$1', [dni]);
    if (result.rows.length === 0) return res.json({ success: false, error: 'Afiliado no encontrado' });
    const afiliado = result.rows[0];
    await pool.query('DELETE FROM afiliados WHERE dni=$1', [dni]);
    await pool.query(
      'INSERT INTO logs (accion, dni, nombre_completo, nro_afiliado, fecha) VALUES ($1,$2,$3,$4,NOW())',
      ['Eliminar', dni, afiliado.nombre_completo, afiliado.nro_afiliado]
    );
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.json({ success: false, error: 'Error al eliminar afiliado' });
  }
});

// Listar logs
app.get('/admin/listar-logs', validarPin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM logs ORDER BY fecha DESC LIMIT 50');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.json({ error: 'Error al cargar logs' });
  }
});

// --- Iniciar servidor ---
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
