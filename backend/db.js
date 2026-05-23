const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DB_NAME = process.env.DB_NAME || 'ecommerce_db';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT) || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASS = process.env.DB_PASSWORD || '';

// ── Step 1: Create database if it doesn't exist, then run schema ──
async function initDatabase() {
    // Bootstrap connection (no DB selected)
    const bootstrap = mysql.createConnection({
        host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASS,
        multipleStatements: true
    });

    await new Promise((resolve, reject) => {
        bootstrap.connect(err => err ? reject(err) : resolve());
    });

    // Create database
    await new Promise((resolve, reject) => {
        bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``, err => err ? reject(err) : resolve());
    });
    console.log(`✅ Database "${DB_NAME}" ready`);

    // Use it
    await new Promise((resolve, reject) => {
        bootstrap.query(`USE \`${DB_NAME}\``, err => err ? reject(err) : resolve());
    });

    // Run schema (creates all tables if they don't exist)
    const schemaPath = path.join(__dirname, 'database', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
        const schema = fs.readFileSync(schemaPath, 'utf8');
        await new Promise((resolve, reject) => {
            bootstrap.query(schema, err => {
                if (err && !err.message.includes('already exists')) return reject(err);
                resolve();
            });
        });
        console.log('✅ Schema tables ready');
    }
    // Create uploads directory
    const uploadsDir = path.join(__dirname, 'uploads', 'products');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
        console.log('✅ Uploads directory created');
    }

    // Run seed (inserts default products + admin)
    const seedPath = path.join(__dirname, 'database', 'seed.sql');
    if (fs.existsSync(seedPath)) {
        const seed = fs.readFileSync(seedPath, 'utf8');
        await new Promise((resolve, reject) => {
            bootstrap.query(seed, err => {
                if (err) return reject(err);
                resolve();
            });
        });
        console.log('✅ Seed data initialized');
    }

    bootstrap.end();
}

// Run init (non-blocking — server still starts while this finishes)
initDatabase().catch(err => {
    console.error('❌ DB init failed:', err.message);
    console.error('   Make sure MySQL is running and DB_USER/DB_PASSWORD in .env are correct.');
});

// ── Step 2: Main connection pool ──
const pool = mysql.createPool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: false
});

const promisePool = pool.promise();

// Verify pool is usable (with retry — DB might not exist yet for 1-2ms)
setTimeout(() => {
    pool.getConnection((err, connection) => {
        if (err) {
            console.error('❌ DB Connection Failed:', err.message);
            return;
        }
        console.log('✅ MySQL connected successfully');
        connection.release();
    });
}, 500); // small delay to let CREATE DATABASE finish first

module.exports = promisePool;
