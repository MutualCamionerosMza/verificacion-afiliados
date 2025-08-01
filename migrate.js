const sqlite3 = require('sqlite3').verbose();
const { Client } = require('pg');

// Cadena de conexión PostgreSQL (pegá tu string aquí)
const PG_CONNECTION_STRING = "postgresql://postgres:GjkavWpkIHpriJMbdszgenornhNLmOmg@switchback.proxy.rlwy.net:18236/railway";

// Abrir la base de datos SQLite local
const sqliteDb = new sqlite3.Database('./afiliados.db', sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('Error al abrir SQLite:', err.message);
    process.exit(1);
  }
  console.log('Conectado a SQLite');
});

// Crear cliente PostgreSQL
const pgClient = new Client({
  connectionString: PG_CONNECTION_STRING,
});

async function migrate() {
  try {
    await pgClient.connect();
    console.log('Conectado a PostgreSQL');

    // Leer afiliados desde SQLite
    sqliteDb.all('SELECT dni, nombre_completo, nro_afiliado FROM afiliados', async (err, rows) => {
      if (err) {
        console.error('Error leyendo SQLite:', err.message);
        await pgClient.end();
        return;
      }

      console.log(`Encontrados ${rows.length} afiliados para migrar`);

      for (const afiliado of rows) {
        const { dni, nombre_completo, nro_afiliado } = afiliado;

        try {
          await pgClient.query(
            'INSERT INTO afiliados (dni, nombre_completo, nro_afiliado) VALUES ($1, $2, $3) ON CONFLICT (dni) DO NOTHING',
            [dni, nombre_completo, nro_afiliado]
          );
          console.log(`Migrado afiliado DNI ${dni}`);
        } catch (err) {
          console.error(`Error insertando DNI ${dni}:`, err.message);
        }
      }

      console.log('Migración finalizada');

      // Cerrar conexiones
      sqliteDb.close();
      await pgClient.end();
    });
  } catch (err) {
    console.error('Error en migración:', err.message);
  }
}

migrate();
