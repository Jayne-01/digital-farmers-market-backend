// scripts/import-historical-sales.js
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const csv = require('csv-parser');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'Digital-Farm-Market',
    password: '010124',
    port: 5432,
});

// === ITO ANG BAGUHIN MO ===
// Ilagay ang tamang path kung nasaan ang iyong CSV files
const SALES_CSV_PATH = "C:\\Users\\Jorinna\\OneDrive\\Desktop\\digital-farmers-market-backend\\data\\sales_data.csv";
const SEARCH_CSV_PATH = "C:\\Users\\Jorinna\\OneDrive\\Desktop\\digital-farmers-market-backend\\data\\search_data.csv";

async function importHistoricalSales() {
    console.log('📊 Importing historical sales data...\n');
    
    // Check if file exists
    if (!fs.existsSync(SALES_CSV_PATH)) {
        console.error(`❌ File not found: ${SALES_CSV_PATH}`);
        console.log('💡 Please check the file path or move the CSV file to the correct location');
        return;
    }
    
    await pool.query(`
        CREATE TABLE IF NOT EXISTS historical_sales (
            id SERIAL PRIMARY KEY,
            product_name VARCHAR(255),
            category VARCHAR(100),
            price DECIMAL(10,2),
            quantity_sold INTEGER,
            sale_date DATE,
            season VARCHAR(50),
            market_location VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    await pool.query('TRUNCATE historical_sales');
    
    const salesData = [];
    
    return new Promise((resolve, reject) => {
        fs.createReadStream(SALES_CSV_PATH)
            .pipe(csv())
            .on('data', (row) => {
                let saleDate = row.sale_date;
                if (saleDate && saleDate.includes('/')) {
                    const parts = saleDate.split('/');
                    saleDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
                }
                
                salesData.push({
                    product_name: row.product_name,
                    category: row.category,
                    price: parseFloat(row.price),
                    quantity_sold: parseInt(row.quantity_sold),
                    sale_date: saleDate,
                    season: row.season,
                    market_location: row.market_location
                });
            })
            .on('end', async () => {
                console.log(`📄 Read ${salesData.length} records from CSV`);
                
                for (const record of salesData) {
                    await pool.query(`
                        INSERT INTO historical_sales 
                        (product_name, category, price, quantity_sold, sale_date, season, market_location)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                    `, [
                        record.product_name, record.category, record.price,
                        record.quantity_sold, record.sale_date, record.season, record.market_location
                    ]);
                }
                
                console.log(`✅ Imported ${salesData.length} historical sales records\n`);
                
                await pool.query(`
                    UPDATE market_product_demand mpd
                    SET total_sales = (
                        SELECT COALESCE(SUM(quantity_sold), 0)
                        FROM historical_sales hs
                        WHERE LOWER(TRIM(hs.product_name)) = LOWER(TRIM(mpd.product_name))
                    ),
                    last_updated = NOW()
                `);
                
                console.log('✅ Updated market_product_demand with aggregated sales');
                resolve();
            })
            .on('error', reject);
    });
}

async function importSearchData() {
    console.log('\n🔍 Importing search data...\n');
    
    if (!fs.existsSync(SEARCH_CSV_PATH)) {
        console.error(`❌ File not found: ${SEARCH_CSV_PATH}`);
        return;
    }
    
    await pool.query(`
        CREATE TABLE IF NOT EXISTS search_trends (
            id SERIAL PRIMARY KEY,
            search_term VARCHAR(255),
            product_name VARCHAR(255),
            search_date DATE,
            estimated_searches INTEGER
        )
    `);
    
    const searchData = [];
    
    return new Promise((resolve, reject) => {
        fs.createReadStream(SEARCH_CSV_PATH)
            .pipe(csv())
            .on('data', (row) => {
                searchData.push({
                    search_term: row.search_term,
                    product_name: row.product_name,
                    search_date: row.search_date,
                    estimated_searches: parseInt(row.estimated_searches)
                });
            })
            .on('end', async () => {
                await pool.query('TRUNCATE search_trends');
                
                for (const record of searchData) {
                    await pool.query(`
                        INSERT INTO search_trends (search_term, product_name, search_date, estimated_searches)
                        VALUES ($1, $2, $3, $4)
                    `, [record.search_term, record.product_name, record.search_date, record.estimated_searches]);
                }
                
                console.log(`✅ Imported ${searchData.length} search records`);
                
                await pool.query(`
                    UPDATE market_product_demand mpd
                    SET search_frequency = (
                        SELECT COALESCE(AVG(estimated_searches), 0)
                        FROM search_trends st
                        WHERE LOWER(TRIM(st.product_name)) = LOWER(TRIM(mpd.product_name))
                    )
                `);
                
                console.log('✅ Updated market_product_demand with search data');
                resolve();
            })
            .on('error', reject);
    });
}

async function main() {
    console.log('========================================');
    console.log('  HISTORICAL DATA IMPORT');
    console.log('========================================\n');
    
    try {
        await pool.query('SELECT NOW()');
        console.log('✅ Database connected\n');
        
        await importHistoricalSales();
        await importSearchData();
        
        console.log('\n========================================');
        console.log('  ✅ IMPORT COMPLETED!');
        console.log('========================================');
        
    } catch (error) {
        console.error('\n❌ Import failed:', error.message);
    } finally {
        await pool.end();
    }
}

main();