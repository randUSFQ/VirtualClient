'use strict';
// SQLite integrado en Node (node:sqlite, Node 22.13 o superior): no hay módulos nativos que compilar.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function abrir(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sesiones (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      email       TEXT    NOT NULL UNIQUE,      -- una entrevista por correo, garantizado por la base de datos
      nombre      TEXT    NOT NULL,
      equipo      TEXT    NOT NULL,
      token       TEXT    NOT NULL,
      estado      TEXT    NOT NULL DEFAULT 'en_curso',   -- en_curso | completada | entregada
      inicio      INTEGER NOT NULL,
      fin         INTEGER,
      motivo      TEXT,
      turnos      TEXT    NOT NULL DEFAULT '[]',
      requisitos  TEXT    NOT NULL DEFAULT '',
      entregado   INTEGER,
      evaluacion  TEXT
    );
  `);
  return db;
}
module.exports = { abrir };
