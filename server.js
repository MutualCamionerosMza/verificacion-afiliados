import express from "express";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import cors from "cors";
import { Pool } from "pg";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(
  cors({
    origin: "https://mutualcamionerosmza.github.io",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "x-admin-pin"],
  })
);

// 🔹 Conexión PostgreSQL
const pool = new Pool({
  connectionString: process.env.PG_CONNECTION_STRING,
  ssl: { rejectUnauthorized: false },
});

pool
  .connect()
  .then(() => console.log("✅ Conectado a PostgreSQL"))
  .catch((err) => console.error("❌ Error al conectar con PostgreSQL:", err));

// ====================================================
// 🔹 RUTA VERIFICAR AFILIADO
// ====================================================
app.post("/verificar", async (req, res) => {
  const { dni } = req.body;
  if (!dni) return res.status(400).json({ error: "Falta el DNI" });

  try {
    const result = await pool.query("SELECT * FROM afiliados WHERE dni = $1", [dni]);
    if (result.rows.length > 0) {
      res.json({ afiliado: true, datos: result.rows[0] });
    } else {
      res.json({ afiliado: false });
    }
  } catch (error) {
    console.error("Error en /verificar:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// ====================================================
// 🔹 RUTA GENERAR CREDENCIAL
// ====================================================
app.get("/credencial", async (req, res) => {
  const { dni } = req.query;
  if (!dni) return res.status(400).send("Falta DNI");

  try {
    const result = await pool.query("SELECT * FROM afiliados WHERE dni = $1", [dni]);
    if (result.rows.length === 0) return res.status(404).send("Afiliado no encontrado");

    const afiliado = result.rows[0];

    // 📏 Tamaño tipo credencial horizontal (14x8.5 cm aprox)
    const mmToPt = (mm) => mm * 2.83465;
    const width = mmToPt(140);
    const height = mmToPt(85);

    const doc = new PDFDocument({
      size: [width, height],
      margins: { top: 20, bottom: 20, left: 30, right: 30 },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=credencial-${dni}.pdf`);
    doc.pipe(res);

    // Fondo gris claro
    doc.rect(0, 0, width, height).fill("#e6e6e6");

    // Marco azul con esquinas redondeadas
    const borderRadius = 15;
    doc
      .save()
      .lineWidth(3)
      .strokeColor("#003366")
      .moveTo(borderRadius, 0)
      .lineTo(width - borderRadius, 0)
      .quadraticCurveTo(width, 0, width, borderRadius)
      .lineTo(width, height - borderRadius)
      .quadraticCurveTo(width, height, width - borderRadius, height)
      .lineTo(borderRadius, height)
      .quadraticCurveTo(0, height, 0, height - borderRadius)
      .lineTo(0, borderRadius)
      .quadraticCurveTo(0, 0, borderRadius, 0)
      .stroke()
      .restore();

    // Título
    doc
      .fillColor("#003366")
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("ASOCIACIÓN MUTUAL CAMIONEROS DE MENDOZA", {
        align: "center",
        lineGap: 8,
      });

    doc.moveDown(1.2);

    // Datos del afiliado
    doc.font("Helvetica").fillColor("#000000").fontSize(12);
    doc.text(`Nombre: ${afiliado.nombre_completo}`, { align: "left" });
    doc.text(`DNI: ${afiliado.dni}`, { align: "left" });
    doc.text(`N° Afiliado: ${afiliado.nro_afiliado}`, { align: "left" });

    // Fecha y hora (ajustada a Argentina UTC−3)
    const fecha = new Date();
    const fechaLocal = new Date(fecha.getTime() - 3 * 60 * 60 * 1000);
    const fechaStr = fechaLocal.toLocaleDateString("es-AR");
    const horaStr =
      fechaLocal.getHours().toString().padStart(2, "0") +
      ":" +
      fechaLocal.getMinutes().toString().padStart(2, "0") +
      ":" +
      fechaLocal.getSeconds().toString().padStart(2, "0");

    doc.text(`Fecha de solicitud: ${fechaStr}, ${horaStr}`, {
      align: "left",
      lineGap: 10,
    });

    // Logo centrado (manteniendo proporción y más grande)
    const logoPath = path.join(__dirname, "assets", "logo.png");
    if (fs.existsSync(logoPath)) {
      const image = fs.readFileSync(logoPath);
      const tempDoc = new PDFDocument({ autoFirstPage: false });
      const img = doc.openImage(image);

      // 🔹 ÚNICO CAMBIO: aumentar logo proporcionalmente
      const logoMaxWidth = width * 0.5;   // 50% del ancho
      const logoMaxHeight = height * 0.35; // 35% de la altura
      let logoWidth = img.width;
      let logoHeight = img.height;

      const ratio = Math.min(logoMaxWidth / logoWidth, logoMaxHeight / logoHeight);
      logoWidth *= ratio;
      logoHeight *= ratio;

      const logoX = (width - logoWidth) / 2;
      const logoY = height - logoHeight - 25;

      doc.image(logoPath, logoX, logoY, {
        width: logoWidth,
        height: logoHeight,
      });
    }

    doc.end();
  } catch (error) {
    console.error("Error generando credencial:", error);
    res.status(500).send("Error generando credencial");
  }
});

// ====================================================
// 🔹 RUTAS ADMINISTRADOR (con PIN)
// ====================================================
const ADMIN_PIN = "1906";

function validarPin(req, res, next) {
  const pin = req.headers["x-admin-pin"];
  if (pin === ADMIN_PIN) return next();
  return res.status(403).json({ error: "PIN incorrecto" });
}

// ➤ Agregar afiliado
app.post("/admin/cargar-afiliados", validarPin, async (req, res) => {
  const { dni, nombre_completo, nro_afiliado } = req.body;
  try {
    await pool.query(
      "INSERT INTO afiliados (dni, nombre_completo, nro_afiliado) VALUES ($1,$2,$3)",
      [dni, nombre_completo, nro_afiliado]
    );
    await pool.query(
      "INSERT INTO logs (accion, dni, nombre_completo, nro_afiliado, fecha) VALUES ($1,$2,$3,$4,NOW())",
      ["Agregar", dni, nombre_completo, nro_afiliado]
    );
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.json({ success: false, error: "Error al agregar afiliado" });
  }
});

// ➤ Editar afiliado
app.put("/admin/editar-afiliado", validarPin, async (req, res) => {
  const { dni, nombre_completo, nro_afiliado } = req.body;
  try {
    await pool.query(
      "UPDATE afiliados SET nombre_completo=$1, nro_afiliado=$2 WHERE dni=$3",
      [nombre_completo, nro_afiliado, dni]
    );
    await pool.query(
      "INSERT INTO logs (accion, dni, nombre_completo, nro_afiliado, fecha) VALUES ($1,$2,$3,$4,NOW())",
      ["Editar", dni, nombre_completo, nro_afiliado]
    );
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.json({ success: false, error: "Error al editar afiliado" });
  }
});

// ➤ Eliminar afiliado
app.post("/admin/eliminar-afiliado", validarPin, async (req, res) => {
  const { dni } = req.body;
  try {
    const result = await pool.query("SELECT * FROM afiliados WHERE dni=$1", [dni]);
    if (result.rows.length === 0)
      return res.json({ success: false, error: "Afiliado no encontrado" });

    const afiliado = result.rows[0];
    await pool.query("DELETE FROM afiliados WHERE dni=$1", [dni]);
    await pool.query(
      "INSERT INTO logs (accion, dni, nombre_completo, nro_afiliado, fecha) VALUES ($1,$2,$3,$4,NOW())",
      ["Eliminar", dni, afiliado.nombre_completo, afiliado.nro_afiliado]
    );
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.json({ success: false, error: "Error al eliminar afiliado" });
  }
});

// ➤ Listar logs
app.get("/admin/listar-logs", validarPin, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM logs ORDER BY fecha DESC LIMIT 50");
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.json({ error: "Error al cargar logs" });
  }
});

// ====================================================
// 🔹 INICIAR SERVIDOR
// ====================================================
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en puerto ${PORT}`);
});
