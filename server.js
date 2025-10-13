import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import PDFDocument from 'pdfkit';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- Configuración CORS correcta ---
app.use(cors({
  origin: 'https://mutualcamionerosmza.github.io',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-admin-pin']
}));

// --- Para que Express entienda JSON ---
app.use(bodyParser.json());

// --- Conexión PostgreSQL ---
const pool = new Pool({
  connectionString: process.env.PG_CONNECTION_STRING,
  ssl: { rejectUnauthorized: false }
});

// --- Middleware para manejar preflight requests OPTIONS ---
app.options('*', cors());

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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

// Generar credencial PDF
app.post('/credencial', async (req, res) => {
  const { dni } = req.body;
  try {
    const result = await pool.query('SELECT * FROM afiliados WHERE dni=$1', [dni]);
    if (result.rows.length === 0) return res.status(404).send('No se encontró afiliado');

    const afiliado = result.rows[0];
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=credencial-${dni}.pdf`);
    doc.text(`Credencial de Afiliado\n\nNombre: ${afiliado.nombre_completo}\nDNI: ${afiliado.dni}\nN° Afiliado: ${afiliado.nro_afiliado}`);
    doc.end();
    doc.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error generando credencial');
  }
});

// --- Resto de rutas de admin (igual que antes) ---
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
    await pool.query('INSERT INTO afiliados (dni,nombre_completo,nro_afiliado) VALUES ($1,$2,$3)', [dni, nombre_completo, nro_afiliado]);
    await pool.query('INSERT INTO logs (accion,dni,nombre_completo,nro_afiliado,fecha) VALUES ($1,$2,$3,$4,NOW())', ['Agregar', dni, nombre_completo, nro_afiliado]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: 'Error al agregar afiliado' });
  }
});

// Editar afiliado
app.put('/admin/editar-afiliado', validarPin, async (req, res) => {
  const { dni, nombre_completo, nro_afiliado } = req.body;
  try {
    await pool.query('UPDATE afiliados SET nombre_completo=$1, nro_afiliado=$2 WHERE dni=$3', [nombre_completo, nro_afiliado, dni]);
    await pool.query('INSERT INTO logs (accion,dni,nombre_completo,nro_afiliado,fecha) VALUES ($1,$2,$3,$4,NOW())', ['Editar', dni, nombre_completo, nro_afiliado]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
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
    await pool.query('INSERT INTO logs (accion,dni,nombre_completo,nro_afiliado,fecha) VALUES ($1,$2,$3,$4,NOW())', ['Eliminar', dni, afiliado.nombre_completo, afiliado.nro_afiliado]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: 'Error al eliminar afiliado' });
  }
});

// Listar logs
app.get('/admin/listar-logs', validarPin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM logs ORDER BY fecha DESC LIMIT 50');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.json({ error: 'Error al cargar logs' });
  }
});

// --- Iniciar servidor ---
app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
