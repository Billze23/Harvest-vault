#!/usr/bin/env node
'use strict';

require('dotenv').config();
const readline = require('readline');
const { users } = require('../database');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function main() {
  console.log('\n=== Harvest Vault — Admin Setup ===\n');

  const existingAdmin = users.findByUsername('admin');
  if (existingAdmin) {
    const ans = await ask('An admin user already exists. Reset password? (y/N): ');
    if (ans.trim().toLowerCase() !== 'y') {
      console.log('Aborted.'); rl.close(); return;
    }
    const pw = await ask('New password (min 8 chars): ');
    if (pw.length < 8) { console.log('Password too short. Aborted.'); rl.close(); return; }
    users.changePassword('admin', pw);
    console.log('\n✓ Admin password updated.\n');
    rl.close(); return;
  }

  const username = (await ask('Admin username [admin]: ')).trim() || 'admin';
  const password = await ask('Admin password (min 8 chars): ');
  if (password.length < 8) {
    console.log('Password too short. Aborted.'); rl.close(); return;
  }

  // Also create a sales user
  const createSales = await ask('\nCreate a sales team user? (Y/n): ');
  let salesUsername = null, salesPassword = null;
  if (createSales.trim().toLowerCase() !== 'n') {
    salesUsername = (await ask('Sales username [sales]: ')).trim() || 'sales';
    salesPassword = await ask('Sales password (min 8 chars): ');
    if (salesPassword.length < 8) {
      console.log('Password too short, skipping sales user.');
      salesUsername = null;
    }
  }

  try {
    users.create(username, password, 'admin');
    console.log(`\n✓ Admin user '${username}' created.`);
    if (salesUsername) {
      users.create(salesUsername, salesPassword, 'sales');
      console.log(`✓ Sales user '${salesUsername}' created.`);
    }
    console.log('\nSetup complete. Start the server with: npm start\n');
  } catch (e) {
    console.error('Error creating user:', e.message);
  }
  rl.close();
}

main().catch(e => { console.error(e); process.exit(1); });
