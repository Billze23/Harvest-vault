'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const bcrypt   = require('bcrypt');
const fs       = require('fs');

const DB_PATH  = process.env.DB_PATH || path.join(__dirname, 'data', 'harvest-vault.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    username  TEXT    NOT NULL UNIQUE,
    password  TEXT    NOT NULL,
    role      TEXT    NOT NULL DEFAULT 'sales',
    created_at TEXT   NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS clients (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    dba          TEXT,
    metrc        TEXT NOT NULL,
    biz_license  TEXT NOT NULL,
    address      TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id               TEXT PRIMARY KEY,
    client_id        TEXT NOT NULL REFERENCES clients(id),
    harvest_date     TEXT NOT NULL,
    wet_weight       REAL NOT NULL,
    services         TEXT NOT NULL DEFAULT '{}',
    deposit_amount   REAL NOT NULL DEFAULT 0,
    deposit_received TEXT NOT NULL DEFAULT 'pending',
    total            REAL NOT NULL DEFAULT 0,
    invoice_num      TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS booking_rooms (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id  TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    room        INTEGER NOT NULL,
    start_date  TEXT NOT NULL,
    end_date    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_bookings_client   ON bookings(client_id);
  CREATE INDEX IF NOT EXISTS idx_bk_rooms_booking  ON booking_rooms(booking_id);
  CREATE INDEX IF NOT EXISTS idx_bk_rooms_dates    ON booking_rooms(room, start_date, end_date);
`);

const seedSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
const defaultPricing = {
  drying:            { name: 'Drying',                     price: 0.25, unit: 'per lb' },
  bucking:           { name: 'Bucking',                    price: 0.15, unit: 'per lb' },
  machineTrim:       { name: 'Machine Trim',               price: 0.20, unit: 'per lb' },
  handTrim:          { name: 'Hand Trim',                  price: 0.45, unit: 'per lb' },
  machineHandPolish: { name: 'Machine Trim + Hand Polish', price: 0.35, unit: 'per lb' },
  bagging:           { name: 'Bagging',                    price: 0.10, unit: 'per lb' }
};
seedSetting.run('pricing',     JSON.stringify(defaultPricing));
seedSetting.run('deposit_pct', '50');

// ── USERS ──────────────────────────────────────────────
const users = {
  findByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  },
  create(username, plainPassword, role = 'sales') {
    const hash = bcrypt.hashSync(plainPassword, 12);
    const info = db.prepare(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`)
      .run(username, hash, role);
    return info.lastInsertRowid;
  },
  verify(username, plainPassword) {
    const user = users.findByUsername(username);
    if (!user) return null;
    const match = bcrypt.compareSync(plainPassword, user.password);
    return match ? { id: user.id, username: user.username, role: user.role } : null;
  },
  changePassword(username, newPlainPassword) {
    const hash = bcrypt.hashSync(newPlainPassword, 12);
    db.prepare('UPDATE users SET password = ? WHERE username = ?').run(hash, username);
  },
  count() {
    return db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  }
};

// ── CLIENTS ────────────────────────────────────────────
const clients = {
  all() {
    return db.prepare('SELECT * FROM clients ORDER BY name ASC').all();
  },
  findById(id) {
    return db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  },
  create({ id, name, dba, metrc, bizLicense, address }) {
    db.prepare(`
      INSERT INTO clients (id, name, dba, metrc, biz_license, address)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, dba || null, metrc, bizLicense, address);
    return clients.findById(id);
  },
  update({ id, name, dba, metrc, bizLicense, address }) {
    db.prepare(`
      UPDATE clients SET name=?, dba=?, metrc=?, biz_license=?, address=?, updated_at=datetime('now')
      WHERE id=?
    `).run(name, dba || null, metrc, bizLicense, address, id);
    return clients.findById(id);
  }
};

// ── BOOKINGS ───────────────────────────────────────────
const bookings = {
  all() {
    const rows = db.prepare('SELECT * FROM bookings ORDER BY created_at DESC').all();
    return rows.map(bookings._attachRooms);
  },
  findById(id) {
    const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    return row ? bookings._attachRooms(row) : null;
  },
  _attachRooms(row) {
    const rooms = db.prepare(
      'SELECT room, start_date, end_date FROM booking_rooms WHERE booking_id = ? ORDER BY room ASC'
    ).all(row.id);
    return {
      ...row,
      services: JSON.parse(row.services || '{}'),
      rooms: rooms.map(r => ({ room: r.room, startDate: r.start_date, endDate: r.end_date }))
    };
  },
  conflictsForRoom(roomNum, startDate, endDate, excludeBookingId = null) {
    let sql = `
      SELECT br.booking_id FROM booking_rooms br
      WHERE br.room = ? AND br.start_date <= ? AND br.end_date >= ?
    `;
    const params = [roomNum, endDate, startDate];
    if (excludeBookingId) { sql += ' AND br.booking_id != ?'; params.push(excludeBookingId); }
    return db.prepare(sql).all(...params);
  },
  save: db.transaction(function(booking) {
    const { id, clientId, harvestDate, wetWeight, services, rooms, total, depositAmount, depositReceived, invoiceNum } = booking;
    const existing = db.prepare('SELECT id FROM bookings WHERE id = ?').get(id);
    if (existing) {
      db.prepare(`
        UPDATE bookings SET client_id=?, harvest_date=?, wet_weight=?, services=?,
          total=?, deposit_amount=?, deposit_received=?, invoice_num=?, updated_at=datetime('now')
        WHERE id=?
      `).run(clientId, harvestDate, wetWeight, JSON.stringify(services), total, depositAmount, depositReceived, invoiceNum, id);
      db.prepare('DELETE FROM booking_rooms WHERE booking_id = ?').run(id);
    } else {
      db.prepare(`
        INSERT INTO bookings (id, client_id, harvest_date, wet_weight, services, total, deposit_amount, deposit_received, invoice_num)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, clientId, harvestDate, wetWeight, JSON.stringify(services), total, depositAmount, depositReceived, invoiceNum);
    }
    const insertRoom = db.prepare(`INSERT INTO booking_rooms (booking_id, room, start_date, end_date) VALUES (?, ?, ?, ?)`);
    for (const r of rooms) insertRoom.run(id, r.room, r.startDate, r.endDate);
    return bookings.findById(id);
  }),
  delete(id) {
    db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
  }
};

// ── SETTINGS ───────────────────────────────────────────
const settings = {
  get(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : null;
  },
  set(key, value) {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, JSON.stringify(value));
  }
};

module.exports = { db, users, clients, bookings, settings };
