// =============================
// 📦 Importar dependencias
// =============================
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import session from "express-session";
import dotenv from "dotenv";
import pkg from "pg";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import moment from "moment";
import csv from "csv-parser";

// =============================
// ⚙️ Configuración inicial
// =============================
dotenv.config();
const { Pool } = pkg;
const app = express();
const PORT = process.env.PORT || 3000;

// =============================
// 🧩 Middlewares
// =============================
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 🔐 Sesiones para el panel admin
app.use(
  session({
    secret: process.env.SESSION_SECRET || "clave-secreta",
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 5 * 60 * 1000 }, // 5 minutos
  })
);

// 🌐 CORS: permitir solo tu frontend
app.use(
  cors({
    origin: "https://mutualcamionerosmza.github.io",
    methods: ["GET", "POST"],
  })
);

// =============================
// 🗄️ Conexión a la base de datos PostgreSQL
// =============================
const pool = new Pool({
  connectionString: process.env.PG_CONNECTION_STRING,
  ssl: { rejectUnauthorized: false },
});

// Probar conexión
pool
  .connect()
  .then(() => console.log("✅ Conectado a PostgreSQL correctamente"))
  .catch((err) => console.error("❌ Error al conectar con PostgreSQL:", err));

// =============================
// 🧾 Rutas de la API
// =============================

// ➤ Verificar afiliado
app.get("/verificar", async (req, res) => {
  try {
    const { dni, nombre, apellido } = req.query;
    if (!dni && (!nombre || !apellido)) {
      return res.status(400).json({ error: "Faltan datos para la verificación" });
    }

    const result = await pool.query(
      "SELECT * FROM afiliados WHERE dni = $1 OR (LOWER(nombre) = LOWER($2) AND LOWER(apellido) = LOWER($3))",
      [dni, nombre, apellido]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ afiliado: null, mensaje: "No se encontró afiliado" });
    }

    res.json({ afiliado: result.rows[0] });
  } catch (error) {
    console.error("Error en /verificar:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ➤ Generar credencial PDF
app.get("/credencial", async (req, res) => {
  try {
    const { dni } = req.query;
    if (!dni) return res.status(400).send("DNI requerido");

    const result = await pool.query("SELECT * FROM afiliados WHERE dni = $1", [dni]);
    if (result.rows.length === 0) return res.status(404).send("Afiliado no encontrado");

    const afiliado = result.rows[0];

    // Crear PDF
    const doc = new PDFDocument({ size: "credit-card", layout: "landscape" });
    const filePath = path.join("/tmp", `credencial_${dni}.pdf`);

    doc.pipe(fs.createWriteStream(filePath));

    // Fondo
    doc.rect(0, 0, 300, 200).fill("#004B8D");
    doc.fillColor("white").fontSize(16).text("Mutual Camioneros Mendoza", 20, 20);

    // Datos
    doc.fillColor("white").fontSize(12);
    doc.text(`Nombre: ${afiliado.nombre}`, 20, 80);
    doc.text(`Apellido: ${afiliado.apellido}`, 20, 100);
    doc.text(`DNI: ${afiliado.dni}`, 20, 120);
    doc.text(`Fecha: ${moment().format("DD/MM/YYYY")}`, 20, 140);

    doc.end();

    doc.on("finish", () => {
      res.download(filePath, `credencial_${dni}.pdf`, () => {
        fs.unlinkSync(filePath); // elimina el archivo temporal
      });
    });
  } catch (error) {
    console.error("Error en /credencial:", error);
    res.status(500).send("Error al generar la credencial");
  }
});

// =============================
// 🧠 Rutas del panel de administración
// =============================

// ➤ Login con PIN
app.post("/login", (req, res) => {
  const { pin } = req.body;
  const ADMIN_PIN = process.env.ADMIN_PIN || "1234";

  if (pin === ADMIN_PIN) {
    req.session.autenticado = true;
    res.json({ exito: true });
  } else {
    res.status(401).json({ exito: false, mensaje: "PIN incorrecto" });
  }
});

// ➤ Verificar sesión
app.get("/session", (req, res) => {
  res.json({ autenticado: req.session.autenticado || false });
});

// ➤ Cerrar sesión
app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ exito: true });
  });
});

// =============================
// 🚀 Iniciar servidor
// =============================
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});
