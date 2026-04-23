const { Pool } = require('pg');
require('dotenv').config();

console.log('=== database.js: Checking database configuration ===');
console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
console.log('DB_USER exists:', !!process.env.DB_USER);
console.log('NODE_ENV:', process.env.NODE_ENV);

// Database connection configuration
let poolConfig;

if (process.env.DATABASE_URL) {
    console.log('database.js: Using DATABASE_URL with SSL required');
    poolConfig = {
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false,
            require: true
        },
    };
} else if (process.env.DB_USER && process.env.DB_HOST) {
    console.log('database.js: Using individual variables with SSL');
    poolConfig = {
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT || 5432,
        ssl: {
            rejectUnauthorized: false,
            require: true
        },
    };
} else {
    console.log('database.js: Using local development configuration');
    poolConfig = {
        user: 'postgres',
        host: 'localhost',
        database: 'Digital-Farm-Market',
        password: '010124',
        port: 5432,
        ssl: false,
    };
}

const pool = new Pool(poolConfig);

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        console.log('✅ Connected to PostgreSQL database successfully');
        release();
    }
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool
};