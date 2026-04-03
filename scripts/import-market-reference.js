// scripts/import-market-reference.js
const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'Digital-Farm-Market',
    password: '010124',
    port: 5432,
});

// ===================== HELPER FUNCTIONS =====================
function calculateDemandScore(totalSales, searchFrequency, price) {
    let score = 0;
    score += Math.min(totalSales / 100, 5) * 1.2;  // Sales weight
    score += Math.min(searchFrequency / 50, 3);     // Search weight
    score += price < 50 ? 1 : (price < 100 ? 0.5 : 0); // Price bonus
    return Math.min(score, 10);
}

// ===================== CREATE MARKET TABLES =====================
async function createMarketTables() {
    console.log('📁 Creating market reference tables...\n');
    
    // Drop old tables
    await pool.query(`DROP TABLE IF EXISTS market_product_demand CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS seasonal_planting_guide CASCADE`);
    
    // Table 1: Market product demand (for What to Sell & Personalized Insights)
    await pool.query(`
        CREATE TABLE market_product_demand (
            id SERIAL PRIMARY KEY,
            product_name VARCHAR(255) NOT NULL UNIQUE,
            category VARCHAR(100),
            base_demand_score FLOAT,
            season VARCHAR(50),
            price_range_min DECIMAL(10,2),
            price_range_max DECIMAL(10,2),
            search_frequency INTEGER DEFAULT 0,
            total_sales INTEGER DEFAULT 0,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // Table 2: Seasonal planting guide (for What to Plant)
    await pool.query(`
        CREATE TABLE seasonal_planting_guide (
            id SERIAL PRIMARY KEY,
            season VARCHAR(50),
            product_name VARCHAR(255),
            demand_score FLOAT,
            planting_months INTEGER[],
            expected_price DECIMAL(10,2),
            notes TEXT,
            UNIQUE(season, product_name)
        )
    `);
    
    console.log('✅ Market tables created\n');
}

// ===================== IMPORT MARKET DEMAND DATA =====================
async function importMarketDemand() {
    console.log('📊 Importing market demand data...\n');
    
    const marketProducts = [
        { name: "Eggplant", category: "Vegetables", sales: 480, searches: 20, price_min: 40, price_max: 60, season: "Year-round" },
        { name: "Tomato", category: "Vegetables", sales: 494, searches: 23, price_min: 50, price_max: 80, season: "Year-round" },
        { name: "Kangkong", category: "Leafy Greens", sales: 508, searches: 26, price_min: 15, price_max: 25, season: "Wet" },
        { name: "Ampalaya", category: "Vegetables", sales: 222, searches: 29, price_min: 45, price_max: 70, season: "Year-round" },
        { name: "Sitaw", category: "Vegetables", sales: 236, searches: 32, price_min: 30, price_max: 45, season: "Dry" },
        { name: "Okra", category: "Vegetables", sales: 250, searches: 35, price_min: 35, price_max: 50, season: "Year-round" },
        { name: "Kalabasa", category: "Vegetables", sales: 264, searches: 38, price_min: 40, price_max: 60, season: "Year-round" },
        { name: "Pechay", category: "Leafy Greens", sales: 278, searches: 41, price_min: 20, price_max: 35, season: "Wet" },
        { name: "Repolyo", category: "Vegetables", sales: 292, searches: 44, price_min: 45, price_max: 70, season: "Wet" },
        { name: "Carrots", category: "Vegetables", sales: 306, searches: 47, price_min: 50, price_max: 80, season: "Year-round" },
        { name: "Labanos", category: "Vegetables", sales: 320, searches: 50, price_min: 25, price_max: 40, season: "Year-round" },
        { name: "Patola", category: "Vegetables", sales: 334, searches: 53, price_min: 40, price_max: 60, season: "Wet" },
        { name: "Upo", category: "Vegetables", sales: 348, searches: 56, price_min: 30, price_max: 45, season: "Wet" },
        { name: "Sayote", category: "Vegetables", sales: 362, searches: 59, price_min: 35, price_max: 50, season: "Year-round" },
        { name: "Malunggay", category: "Leafy Greens", sales: 376, searches: 62, price_min: 10, price_max: 20, season: "Year-round" },
        { name: "Gabi", category: "Root Crops", sales: 390, searches: 65, price_min: 45, price_max: 70, season: "Wet" },
        { name: "Kamote", category: "Root Crops", sales: 404, searches: 68, price_min: 40, price_max: 60, season: "Year-round" },
        { name: "Cassava", category: "Root Crops", sales: 418, searches: 71, price_min: 35, price_max: 55, season: "Year-round" },
        { name: "Onion", category: "Vegetables", sales: 432, searches: 74, price_min: 80, price_max: 120, season: "Year-round" },
        { name: "Garlic", category: "Vegetables", sales: 446, searches: 77, price_min: 100, price_max: 150, season: "Year-round" },
        { name: "Ginger", category: "Vegetables", sales: 460, searches: 20, price_min: 80, price_max: 120, season: "Year-round" },
        { name: "Bell Pepper", category: "Vegetables", sales: 474, searches: 23, price_min: 100, price_max: 150, season: "Dry" },
        { name: "Chili", category: "Vegetables", sales: 488, searches: 26, price_min: 100, price_max: 150, season: "Year-round" },
        { name: "Cucumber", category: "Vegetables", sales: 502, searches: 29, price_min: 35, price_max: 55, season: "Dry" },
        { name: "Lettuce", category: "Leafy Greens", sales: 516, searches: 32, price_min: 50, price_max: 80, season: "Dry" },
        { name: "Mongo", category: "Legumes", sales: 275, searches: 35, price_min: 60, price_max: 90, season: "Wet" },
        { name: "Peanut", category: "Legumes", sales: 282, searches: 38, price_min: 70, price_max: 100, season: "Year-round" },
        { name: "Alugbati", category: "Leafy Greens", sales: 289, searches: 41, price_min: 20, price_max: 35, season: "Wet" },
        { name: "Mustasa", category: "Leafy Greens", sales: 296, searches: 44, price_min: 25, price_max: 40, season: "Wet" },
        { name: "Basil", category: "Herbs", sales: 303, searches: 47, price_min: 30, price_max: 50, season: "Year-round" },
        { name: "Spring Onion", category: "Vegetables", sales: 310, searches: 0, price_min: 35, price_max: 55, season: "Year-round" },
        { name: "Corn", category: "Crops", sales: 338, searches: 0, price_min: 30, price_max: 50, season: "Dry" }
    ];
    
    let imported = 0;
    
    for (const product of marketProducts) {
        const avgPrice = (product.price_min + product.price_max) / 2;
        const demandScore = calculateDemandScore(product.sales, product.searches, avgPrice);
        
        await pool.query(`
            INSERT INTO market_product_demand 
            (product_name, category, base_demand_score, season, 
             price_range_min, price_range_max, search_frequency, total_sales)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (product_name) DO UPDATE SET
                base_demand_score = EXCLUDED.base_demand_score,
                search_frequency = EXCLUDED.search_frequency,
                total_sales = EXCLUDED.total_sales
        `, [
            product.name, product.category, demandScore, product.season,
            product.price_min, product.price_max, product.searches, product.sales
        ]);
        
        imported++;
        console.log(`   ✅ ${product.name}: ${demandScore.toFixed(1)}/10 (${product.sales} sold, ${product.searches} searches)`);
    }
    
    console.log(`\n✅ Imported ${imported} market products\n`);
}

// ===================== IMPORT SEASONAL PLANTING GUIDE =====================
async function importSeasonalGuide() {
    console.log('🌱 Importing seasonal planting guide...\n');
    
    const seasonalGuide = [
        { season: "Dry", product: "Watermelon", demand: 9.0, months: [3,4,5], price: 80, notes: "Best planted in early dry season" },
        { season: "Dry", product: "Mango", demand: 8.8, months: [3,4,5], price: 120, notes: "Requires full sun" },
        { season: "Dry", product: "Corn", demand: 8.2, months: [3,4,5,6], price: 45, notes: "Harvest in 60-90 days" },
        { season: "Dry", product: "Squash", demand: 7.8, months: [3,4,5], price: 35, notes: "Good for storage" },
        { season: "Dry", product: "Cucumber", demand: 7.5, months: [3,4,5,6], price: 40, notes: "High water requirement" },
        { season: "Wet", product: "Rice", demand: 9.5, months: [7,8,9,10,11,12], price: 50, notes: "Needs plenty of water" },
        { season: "Wet", product: "Pechay", demand: 8.5, months: [7,8,9,10,11], price: 25, notes: "Quick harvest 30 days" },
        { season: "Wet", product: "Kangkong", demand: 8.3, months: [7,8,9,10,11,12], price: 20, notes: "Grows well in water" },
        { season: "Wet", product: "Mustasa", demand: 7.8, months: [7,8,9,10], price: 22, notes: "Leafy green" },
        { season: "Wet", product: "Lettuce", demand: 7.5, months: [7,8,9,10,11], price: 35, notes: "Cool season crop" }
    ];
    
    let imported = 0;
    
    for (const guide of seasonalGuide) {
        await pool.query(`
            INSERT INTO seasonal_planting_guide 
            (season, product_name, demand_score, planting_months, expected_price, notes)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (season, product_name) DO UPDATE SET
                demand_score = EXCLUDED.demand_score,
                planting_months = EXCLUDED.planting_months,
                expected_price = EXCLUDED.expected_price,
                notes = EXCLUDED.notes
        `, [
            guide.season,
            guide.product,
            guide.demand,
            guide.months,
            guide.price,
            guide.notes
        ]);
        
        imported++;
        console.log(`   ✅ ${guide.season} Season: ${guide.product} (Score: ${guide.demand}/10)`);
    }
    
    console.log(`\n✅ Imported ${imported} seasonal guides\n`);
}

// ===================== VERIFY IMPORT =====================
async function verifyImport() {
    console.log('📊 VERIFYING IMPORT...\n');
    
    const products = await pool.query(`
        SELECT COUNT(*) as count, 
               ROUND(AVG(base_demand_score)::numeric, 1) as avg_score,
               SUM(total_sales) as total_sales,
               SUM(search_frequency) as total_searches
        FROM market_product_demand
    `);
    
    const seasonal = await pool.query('SELECT COUNT(*) as count FROM seasonal_planting_guide');
    
    console.log(`   ├─ Market Products: ${products.rows[0].count}`);
    console.log(`   ├─ Average Demand Score: ${products.rows[0].avg_score || 0}/10`);
    console.log(`   ├─ Total Market Sales: ${(products.rows[0].total_sales || 0).toLocaleString()} units`);
    console.log(`   ├─ Total Searches: ${(products.rows[0].total_searches || 0).toLocaleString()}`);
    console.log(`   └─ Seasonal Guides: ${seasonal.rows[0].count}`);
    
    const topProducts = await pool.query(`
        SELECT product_name, ROUND(base_demand_score::numeric, 1) as demand_score, total_sales, search_frequency
        FROM market_product_demand
        ORDER BY base_demand_score DESC
        LIMIT 5
    `);
    
    console.log(`\n   🌟 TOP 5 MARKET DEMAND PRODUCTS:`);
    topProducts.rows.forEach((p, idx) => {
        console.log(`      ${idx+1}. ${p.product_name}: ${p.demand_score}/10 (${p.total_sales.toLocaleString()} sold, ${p.search_frequency || 0} searches)`);
    });
}

// ===================== MAIN =====================
async function main() {
    console.log('========================================');
    console.log('  MARKET REFERENCE DATA IMPORT');
    console.log('========================================\n');
    
    try {
        await pool.query('SELECT NOW()');
        console.log('✅ Database connected\n');
        
        await createMarketTables();
        await importMarketDemand();
        await importSeasonalGuide();
        await verifyImport();
        
        console.log('\n========================================');
        console.log('  ✅ IMPORT COMPLETED!');
        console.log('========================================');
        console.log('\n🎉 Data available for ALL farmers:');
        console.log('   • Market demand scores (for What to Sell)');
        console.log('   • Seasonal planting guide (for What to Plant)');
        console.log('   • Search insights (for unmet demand)');
        
    } catch (error) {
        console.error('\n❌ Import failed:', error.message);
    } finally {
        await pool.end();
    }
}

main();