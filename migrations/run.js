require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Cara pakai:
//   npm run migrate            → jalankan migration baru saja
//   npm run migrate:fresh      → reset total lalu migrate ulang dari awal
//   npm run seed               → jalankan seed saja (tanpa schema)
const args = process.argv.slice(2);
const isFresh = args.includes('--fresh');
const seedOnly = args.includes('--seed');

// Password default untuk semua user seed — bisa diubah via .env
const DEFAULT_PASSWORD = process.env.SEED_PASSWORD || 'Admin@12345';

async function fixSeedPasswords(client) {
  console.log('\n🔐 Generate hash password default...');
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 12);

  const result = await client.query(
    `UPDATE users
     SET password_hash = $1
     WHERE username IN ('admin', 'superadmin', 'finance01', 'hr01')
     RETURNING username`,
    [hash]
  );

  if (result.rows.length > 0) {
    const names = result.rows.map(r => r.username).join(', ');
    console.log(`✅ Password di-set untuk: ${names}`);
  } else {
    console.log('⚠️  Tidak ada user yang diupdate');
  }
}

async function runMigrations() {
  const client = await pool.connect();
  try {
    if (isFresh) {
      console.log('⚠️  Mode FRESH: menghapus semua tabel...');
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      console.log('✅ Schema direset');
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const migrationDir = path.join(__dirname);
    let files = fs.readdirSync(migrationDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (seedOnly) {
      files = files.filter(f => !f.startsWith('001_'));
      console.log('🌱 Mode SEED: hanya menjalankan data seed...');
    }

    let ranCount = 0;
    for (const file of files) {
      if (!isFresh) {
        const existing = await client.query(
          'SELECT id FROM migrations WHERE filename = $1', [file]
        );
        if (existing.rows.length > 0) {
          console.log(`⏭️  Sudah dijalankan: ${file}`);
          continue;
        }
      }

      const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO migrations (filename) VALUES ($1)
           ON CONFLICT (filename) DO UPDATE SET executed_at = NOW()`,
          [file]
        );
        await client.query('COMMIT');
        console.log(`✅ Berhasil: ${file}`);
        ranCount++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ Gagal: ${file} — ${err.message}`);
        throw err;
      }
    }

    // Auto-fix password hash setiap kali ada file yang baru dijalankan
    if (isFresh || seedOnly || ranCount > 0) {
      await fixSeedPasswords(client);
    }

    console.log('\n🎉 Migrasi selesai!');
    console.log('──────────────────────────────────');
    console.log('Login default:');
    console.log('  Username : admin');
    console.log(`  Password : ${DEFAULT_PASSWORD}`);
    console.log('');
    console.log('Untuk ubah password default seed:');
    console.log('  Tambahkan SEED_PASSWORD=PasswordKamu di .env');
    console.log('──────────────────────────────────');

  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch(err => {
  console.error('\n❌ Migration gagal:', err.message);
  console.error('Pastikan:');
  console.error('  1. PostgreSQL sedang berjalan');
  console.error('  2. .env sudah dikonfigurasi (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD)');
  console.error('  3. Database sudah dibuat: CREATE DATABASE erp_db;');
  process.exit(1);
});
