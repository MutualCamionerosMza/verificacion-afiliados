// server.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { Pool } from "pg";
import PDFDocument from "pdfkit";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 🟢 CORS (permitimos el frontend de GitHub Pages)
app.use(cors({
  origin: "https://mutualcamionerosmza.github.io",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "x-admin-pin"]
}));

app.use(bodyParser.json());

// 🟢 Conexión PostgreSQL
const pool = new Pool({
  connectionString: process.env.PG_CONNECTION_STRING,
  ssl: { rejectUnauthorized: false }
});

// 🟢 Prueba de conexión
pool.connect()
  .then(() => console.log("✅ Conectado a PostgreSQL correctamente"))
  .catch(err => console.error("❌ Error al conectar con PostgreSQL:", err));

// 🟢 Ruta raíz para probar
app.get("/", (req, res) => {
  res.send("Servidor de afiliados activo 🚀");
});

// 🟢 Ruta: verificar afiliado
app.post("/verificar", async (req, res) => {
  const { dni } = req.body;

  if (!dni) return res.status(400).json({ error: "DNI requerido" });

  try {
    const result = await pool.query("SELECT * FROM afiliados WHERE dni = $1", [dni]);
    if (result.rows.length > 0) {
      res.json({ afiliado: true, datos: result.rows[0] });
    } else {
      res.json({ afiliado: false });
    }
  } catch (error) {
    console.error("Error en /verificar:", error);
    res.status(500).json({ error: "Error en la base de datos" });
  }
});

// 🟢 Ruta: credencial PDF
app.post("/credencial", async (req, res) => {
  const { dni } = req.body;
  try {
    const result = await pool.query("SELECT * FROM afiliados WHERE dni=$1", [dni]);
    if (result.rows.length === 0) return res.status(404).send("No se encontró afiliado");

    const afiliado = result.rows[0];
    const doc = new PDFDocument();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=credencial-${dni}.pdf`);
    doc.pipe(res);
    doc.text(`Credencial de Afiliado\n\nNombre: ${afiliado.nombre_completo}\nDNI: ${afiliado.dni}\nN° Afiliado: ${afiliado.nro_afiliado}`);
    doc.end();
  } catch (error) {
    console.error(error);
    res.status(500).send("Error generando credencial");
  }
});

// 🟢 Resto de rutas administrativas
const ADMIN_PIN = process.env.ADMIN_PIN || "1906";

function validarPin(req, res, next) {
  const pin = req.headers["x-admin-pin"];
  if (pin === ADMIN_PIN) return next();
  return res.status(403).json({ error: "PIN incorrecto" });
}

app.post("/admin/cargar-afiliados", validarPin, async (req, res) => {
  const { dni, nombre_completo, nro_afiliado } = req.body;
  try {
    await pool.query("INSERT INTO afiliados (dni, nombre_completo, nro_afiliado) VALUES ($1,$2,$3)", [dni, nombre_completo, nro_afiliado]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.json({ success: false, error: "Error al agregar afiliado" });
  }
});

// 🟢 Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});
