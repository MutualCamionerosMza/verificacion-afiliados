// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pg from "pg";
import fs from "fs";
import csv from "csv-parser";
import path from "path";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// =============================
// 🔹 CONFIGURACIÓN GENERAL
// =============================
const PORT = process.env.PORT || 8080;
const isProduction = process.env.RAILWAY_ENVIRONMENT_NAME !== undefined;

console.log(`🚀 Modo: ${isProduction ? "Producción (Railway)" : "Desarrollo (local)"}`);

// Intentar usar PG_CONNECTION_STRING, y si no existe, DATABASE_URL
const connectionString =
  process.env.PG_CONNECTION_STRING ||
  process.env.DATABASE_URL ||
  null;

console.log("🔹 PG_CONNECTION_STRING:", process.env.PG_CONNECTION_STRING);
console.log("🔹 DATABASE_URL:", process.env.DATABASE_URL);

if (!connectionString) {
  console.error("❌ ERROR: No se encontró una cadena de conexión válida para PostgreSQL.");
  process.exit(1);
}

// =============================
// 🔹 CONEXIÓN A POSTGRESQL
// =============================
const pool = new pg.Pool({
  connectionString,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

pool.connect()
  .then(() => console.log("✅ Conectado a PostgreSQL"))
  .catch(err => {
    console.error("❌ Error conectando a PostgreSQL:", err.message);
    process.exit(1);
  });

// =============================
// 🔹 TABLA DE AFILIADOS
// =============================
const crearTabla = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS afiliados (
      id SERIAL PRIMARY KEY,
      dni VARCHAR(20) UNIQUE,
      nombre_completo VARCHAR(100),
      nro_afiliado VARCHAR(50),
      categoria VARCHAR(50),
      empresa VARCHAR(100),
      fecha_alta DATE
    );
  `;
  await pool.query(query);
  console.log("🗃️ Tabla 'afiliados' verificada");
};

crearTabla();

// =============================
// 🔹 RUTAS PRINCIPALES
// =============================

// Ruta raíz (para testear conexión)
app.get("/", (req, res) => {
  res.send("✅ Servidor y base de datos funcionando correctamente.");
});

// Verificar afiliado por DNI o nombre
app.get("/verificar", async (req, res) => {
  try {
    const { dni, nombre, apellido } = req.query;

    if (!dni && (!nombre || !apellido)) {
      return res.status(400).json({ error: "Debe proporcionar DNI o nombre y apellido." });
    }

    let query, values;

    if (dni) {
      query = "SELECT * FROM afiliados WHERE dni = $1";
      values = [dni];
    } else {
      query = "SELECT * FROM afiliados WHERE LOWER(nombre_completo) LIKE LOWER($1)";
      values = [`%${apellido}, ${nombre}%`];
    }

    const result = await pool.query(query, values);

    if (result.rows.length > 0) {
      res.json({ afiliado: result.rows[0], mensaje: "Afiliado encontrado ✅" });
    } else {
      res.status(404).json({ mensaje: "No se encontró ningún afiliado con esos datos ❌" });
    }
  } catch (err) {
    console.error("❌ Error en /verificar:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// Agregar afiliado (desde panel admin)
app.post("/agregar", async (req, res) => {
  try {
    const { dni, nombre_completo, nro_afiliado, categoria, empresa, fecha_alta } = req.body;
    if (!dni || !nombre_completo) {
      return res.status(400).json({ error: "Faltan datos obligatorios." });
    }

    const query = `
      INSERT INTO afiliados (dni, nombre_completo, nro_afiliado, categoria, empresa, fecha_alta)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (dni) DO UPDATE
      SET nombre_completo = EXCLUDED.nombre_completo,
          nro_afiliado = EXCLUDED.nro_afiliado,
          categoria = EXCLUDED.categoria,
          empresa = EXCLUDED.empresa,
          fecha_alta = EXCLUDED.fecha_alta;
    `;

    await pool.query(query, [dni, nombre_completo, nro_afiliado, categoria, empresa, fecha_alta]);
    res.json({ mensaje: "Afiliado agregado o actualizado correctamente ✅" });
  } catch (err) {
    console.error("❌ Error en /agregar:", err);
    res.status(500).json({ error: "Error al guardar afiliado." });
  }
});

// Listar afiliados (para panel admin)
app.get("/listado", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM afiliados ORDER BY nombre_completo ASC");
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error en /listado:", err);
    res.status(500).json({ error: "Error al obtener el listado." });
  }
});

// Eliminar afiliado
app.delete("/eliminar/:dni", async (req, res) => {
  try {
    const { dni } = req.params;
    await pool.query("DELETE FROM afiliados WHERE dni = $1", [dni]);
    res.json({ mensaje: "Afiliado eliminado correctamente 🗑️" });
  } catch (err) {
    console.error("❌ Error en /eliminar:", err);
    res.status(500).json({ error: "Error al eliminar afiliado." });
  }
});

// =============================
// 🔹 INICIO DEL SERVIDOR
// =============================
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
});
