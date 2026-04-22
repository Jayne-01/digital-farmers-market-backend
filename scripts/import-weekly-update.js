// scripts/import-weekly-update.js
const fs = require('fs');
const { Pool } = require('pg');
const csv = require('csv-parser');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'Digital-Farm-Market',
    password: '010124',
    port: 5432,
});

const WEEKLY_CSV_PATH = 'C:\\Users\\Jorinna\\OneDrive\\Desktop\\digital-farmers-market-backend\\data\\weekly_data_update.csv';

async function importWeeklyUpdate() {
    console.log('📊 Importing weekly update...\n');
    
    if (!fs.existsSync(WEEKLY_CSV_PATH)) {
        console.error(`❌ File not found: ${WEEKLY_CSV_PATH}`);
        return;
    }
    
    const weeklyData = [];
    
    return new Promise((resolve, reject) => {
        fs.createReadStream(WEEKLY_CSV_PATH)
            .pipe(csv())
            .on('data', (row) => {
                // Convert date format from DD/MM/YYYY to YYYY-MM-DD
                let saleDate = row.sale_date;
                if (saleDate && saleDate.includes('/')) {
                    const parts = saleDate.split('/');
                    saleDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
                }
                
                weeklyData.push({
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
                console.log(`📄 Read ${weeklyData.length} records from weekly file`);
                
                // Insert into historical_sales (append)
                let inserted = 0;
                for (const record of weeklyData) {
                    // Check if record already exists to avoid duplicates
                    const check = await pool.query(`
                        SELECT id FROM historical_sales 
                        WHERE product_name = $1 AND sale_date = $2 AND market_location = $3
                        LIMIT 1
                    `, [record.product_name, record.sale_date, record.market_location]);
                    
                    if (check.rows.length === 0) {
                        await pool.query(`
                            INSERT INTO historical_sales 
                            (product_name, category, price, quantity_sold, sale_date, season, market_location)
                            VALUES ($1, $2, $3, $4, $5, $6, $7)
                        `, [
                            record.product_name, record.category, record.price,
                            record.quantity_sold, record.sale_date, record.season, record.market_location
                        ]);
                        inserted++;
                    }
                }
                
                console.log(`✅ Added ${inserted} new weekly records to historical_sales`);
                
                // Update market_product_demand with new aggregated sales
                await pool.query(`
                    UPDATE market_product_demand mpd
                    SET total_sales = (
                        SELECT COALESCE(SUM(quantity_sold), 0)
                        FROM historical_sales hs
                        WHERE LOWER(TRIM(hs.product_name)) = LOWER(TRIM(mpd.product_name))
                    ),
                    last_updated = NOW()
                `);
                
                console.log('✅ Updated market_product_demand with new sales data');
                
                // Update price ranges based on latest data
                for (const record of weeklyData) {
                    await pool.query(`
                        UPDATE market_product_demand
                        SET price_range_min = LEAST(price_range_min, $1),
                            price_range_max = GREATEST(price_range_max, $1)
                        WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($2))
                    `, [record.price, record.product_name]);
                }
                
                console.log('✅ Updated price ranges');
                resolve();
            })
            .on('error', reject);
    });
}

async function main() {
    console.log('========================================');
    console.log('  WEEKLY DATA UPDATE');
    console.log('========================================\n');
    
    try {
        await pool.query('SELECT NOW()');
        console.log('✅ Database connected\n');
        
        await importWeeklyUpdate();
        
        // Retrain ML model
        console.log('\n🔄 Retraining Random Forest model with new data...');
        const randomForest = require('../services/ml/randomForestPredictor');
        await randomForest.trainModel();
        
        console.log('\n========================================');
        console.log('  ✅ WEEKLY UPDATE COMPLETED!');
        console.log('========================================');
        console.log('\n🎉 New weekly data has been:');
        console.log('   • Added to historical_sales table');
        console.log('   • Updated market_product_demand scores');
        console.log('   • Retrained ML model');
        console.log('   • Ready for new recommendations');
        
    } catch (error) {
        console.error('\n❌ Update failed:', error.message);
    } finally {
        await pool.end();
    }
}

main();