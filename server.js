'use strict';

require('dotenv').config();

const express      = require('express');
const session      = require('express-session');
const SQLiteStore  = require('connect-sqlite3')(session);
const path         = require('path');
const fs           = require('fs');
const { users, clients, bookings, settings } = require('./database');

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const app  = express();
const PORT = process.env.PORT || 3000;

const ROOMS    = 8;
const DRY_DAYS = 10;
function roomCap(n) { return n % 2 === 0 ? 12000 : 10000; }

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'data') }),
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge:   8 * 60 * 60 * 1000
  }
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.status(401).json({ error: 'Not authenticated' });
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  res.status(403).json({ error: 'Admin access required' });
}

// ── AUTH ───────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = users.verify(username, password);
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });
  req.session.user = user;
  res.json({ user: { username: user.username, role: user.role } });
});

app.post('/api/auth/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.user)
    return res.json({ user: { username: req.session.user.username, role: req.session.user.role } });
  res.json({ user: null });
});

app.post('/api/auth/change-password', requireAuth, requireAdmin, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  users.changePassword(req.session.user.username, newPassword);
  res.json({ ok: true });
});

// ── CLIENTS ────────────────────────────────────────────
app.get('/api/clients', requireAuth, (req, res) => { res.json(clients.all().map(normalizeClient)); });

app.post('/api/clients', requireAuth, (req, res) => {
  const { name, dba, metrc, bizLicense, address } = req.body;
  if (!name || !metrc || !bizLicense || !address) return res.status(400).json({ error: 'Missing required fields' });
  const id = uid();
  res.status(201).json(normalizeClient(clients.create({ id, name, dba, metrc, bizLicense, address })));
});

app.put('/api/clients/:id', requireAuth, (req, res) => {
  const { name, dba, metrc, bizLicense, address } = req.body;
  if (!name || !metrc || !bizLicense || !address) return res.status(400).json({ error: 'Missing required fields' });
  const client = clients.update({ id: req.params.id, name, dba, metrc, bizLicense, address });
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(normalizeClient(client));
});

function normalizeClient(c) {
  return { id: c.id, name: c.name, dba: c.dba, metrc: c.metrc, bizLicense: c.biz_license, address: c.address, createdAt: c.created_at };
}

// ── BOOKINGS ───────────────────────────────────────────
app.get('/api/bookings', requireAuth, (req, res) => { res.json(bookings.all()); });

app.post('/api/bookings', requireAuth, (req, res) => {
  const err = validateBookingBody(req.body);
  if (err) return res.status(400).json({ error: err });
  const { harvestDate, wetWeight, services, depositAmount, depositReceived, clientId } = req.body;
  const start = new Date(harvestDate); start.setHours(0, 0, 0, 0);
  const end   = new Date(start);       end.setDate(end.getDate() + DRY_DAYS - 1);
  const rooms = assignRooms(wetWeight, start.toISOString(), end.toISOString(), null);
  if (!rooms) return res.status(409).json({ error: 'No room capacity available for those dates' });
  const total  = calcTotal(wetWeight, services, settings.get('pricing'));
  const id     = uid();
  const invNum = 'HV-' + new Date().getFullYear() + '-' + String(Math.floor(Math.random() * 9000) + 1000);
  const booking = bookings.save({
    id, clientId, harvestDate, wetWeight, services,
    rooms: rooms.map(r => ({ room: r, startDate: start.toISOString(), endDate: end.toISOString() })),
    total, depositAmount: depositAmount || 0, depositReceived: depositReceived || 'pending', invoiceNum: invNum
  });
  res.status(201).json(booking);
});

app.put('/api/bookings/:id', requireAuth, (req, res) => {
  const existing = bookings.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Booking not found' });
  const err = validateBookingBody(req.body);
  if (err) return res.status(400).json({ error: err });
  const { harvestDate, wetWeight, services, depositAmount, depositReceived, clientId } = req.body;
  const start = new Date(harvestDate); start.setHours(0, 0, 0, 0);
  const end   = new Date(start);       end.setDate(end.getDate() + DRY_DAYS - 1);
  const rooms = assignRooms(wetWeight, start.toISOString(), end.toISOString(), req.params.id);
  if (!rooms) return res.status(409).json({ error: 'No room capacity available for those dates' });
  const total = calcTotal(wetWeight, services, settings.get('pricing'));
  const booking = bookings.save({
    id: req.params.id, clientId, harvestDate, wetWeight, services,
    rooms: rooms.map(r => ({ room: r, startDate: start.toISOString(), endDate: end.toISOString() })),
    total, depositAmount: depositAmount || 0, depositReceived: depositReceived || 'pending',
    invoiceNum: existing.invoice_num || existing.invoiceNum
  });
  res.json(booking);
});

app.delete('/api/bookings/:id', requireAuth, requireAdmin, (req, res) => {
  const existing = bookings.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Booking not found' });
  bookings.delete(req.params.id);
  res.json({ ok: true });
});

function validateBookingBody(body) {
  const { clientId, harvestDate, wetWeight } = body;
  if (!clientId) return 'clientId is required';
  if (!harvestDate) return 'harvestDate is required';
  if (!wetWeight || wetWeight <= 0) return 'wetWeight must be a positive number';
  if (!clients.findById(clientId)) return 'Client not found';
  return null;
}

// ── SETTINGS ───────────────────────────────────────────
app.get('/api/settings', requireAuth, (req, res) => {
  res.json({ pricing: settings.get('pricing'), depositPct: Number(settings.get('deposit_pct')) });
});

app.put('/api/settings', requireAuth, requireAdmin, (req, res) => {
  const { pricing, depositPct } = req.body;
  if (pricing) settings.set('pricing', pricing);
  if (depositPct !== undefined) settings.set('deposit_pct', String(depositPct));
  res.json({ ok: true });
});

// ── ROOM ENGINE ────────────────────────────────────────
function assignRooms(lbs, startISO, endISO, excludeBookingId) {
  const available = [];
  for (let r = 1; r <= ROOMS; r++) {
    const conflicts = bookings.conflictsForRoom(r, startISO, endISO, excludeBookingId);
    if (conflicts.length === 0) available.push({ r, cap: roomCap(r) });
  }
  available.sort((a, b) => b.cap - a.cap);
  let remaining = lbs;
  const assigned = [];
  for (const a of available) {
    if (remaining <= 0) break;
    assigned.push(a.r);
    remaining -= a.cap;
  }
  return remaining > 0 ? null : assigned;
}

function calcTotal(wetWeight, services, pricing) {
  if (!pricing) return 0;
  return Object.entries(services || {}).reduce((sum, [key, selected]) => {
    if (selected && pricing[key]) sum += wetWeight * pricing[key].price;
    return sum;
  }, 0);
}

// ── CATCH-ALL ──────────────────────────────────────────
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.listen(PORT, () => {
  console.log(`Harvest Vault running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  if (users.count() === 0) console.log('\n⚠️  No users found. Run: npm run setup-admin\n');
});
