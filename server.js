import express from "express";
import cors from "cors";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ CONFIGURACIÓN CORRECTA DE CORS
const corsOptions = {
  origin: [
    "https://mutualcamionerosmza.github.io", // Frontend en GitHub Pages
    "http://localhost:3000", // Por si probás localmente
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.options("*", cors());// ✅ Manejo de preflight

app.use(express.json());

// ✅ Conexión a PostgreSQL (Railway)
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.PG_CONNECTION_STRING,
  ssl: { rejectUnauthorized: false },
});

// 🔍 Verificar conexión a la base de datos
pool
  .connect()
  .then(() => console.log("✅ Conectado correctamente a PostgreSQL"))
  .catch((err) => console.error("❌ Error al conectar con PostgreSQL:", err));

// ✅ Ruta raíz
app.get("/", (req, res) => {
  res.send("Servidor funcionando correctamente ✅");
});

// ✅ Ruta para verificar afiliado
app.post("/verificar", async (req, res) => {
  try {
    const { dni, nombre, apellido } = req.body;

    if (!dni && (!nombre || !apellido)) {
      return res
        .status(400)
        .json({ error: "Debe proporcionar DNI o Nombre y Apellido" });
    }

    let query = "SELECT * FROM afiliados WHERE ";
    const params = [];

    if (dni) {
      query += "dni = $1";
      params.push(dni);
    } else {
      query += "LOWER(nombre) = LOWER($1) AND LOWER(apellido) = LOWER($2)";
      params.push(nombre, apellido);
    }

    const result = await pool.query(query, params);

    if (result.rows.length > 0) {
      res.json({ afiliado: result.rows[0], existe: true });
    } else {
      res.json({ existe: false });
    }
  } catch (error) {
    console.error("❌ Error en /verificar:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ✅ Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});
