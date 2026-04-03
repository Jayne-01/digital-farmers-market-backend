// routes/recommendationRoutes.js
const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');
const pool = require('../config/database');
const randomForest = require('../services/ml/randomForestPredictor');

// ====================== HELPER FUNCTIONS ======================
function getCurrentSeason() {
    const month = new Date().getMonth() + 1;
    return (month >= 3 && month <= 6) ? 'Dry' : 'Wet';
}

function getMonthName(month) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[month - 1];
}

// ===================== 1. YOUR FARM PERFORMANCE =====================
router.get('/farm-performance', authenticateToken, authorizeRole('FARMER'), async (req, res) => {
    try {
        const userId = req.user.user_id || req.user.id;
        
        console.log('=== Farm Performance Debug ===');
        console.log('User ID:', userId);
        
        // Get farmer_id from user_id
        const farmerQuery = await pool.query(`
            SELECT farmer_id FROM farmers WHERE user_id = $1
        `, [userId]);
        
        if (farmerQuery.rows.length === 0) {
            return res.json({
                success: true,
                products: [],
                summary: {
                    total_products: 0,
                    total_sales: 0,
                    top_product: 'None'
                },
                message: "Farmer profile not found"
            });
        }
        
        const farmerId = farmerQuery.rows[0].farmer_id;
        console.log('Farmer ID:', farmerId);
        
        // Get ALL farmer's products with sales from DELIVERED orders ONLY
        const farmerProducts = await pool.query(`
            SELECT 
                p.product_id,
                p.product_name,
                p.price,
                p.category,
                COALESCE(
                    (SELECT SUM(oi.quantity) 
                     FROM order_items oi 
                     JOIN orders o ON oi.order_id = o.order_id 
                     WHERE oi.product_id = p.product_id 
                     AND o.order_status = 'DELIVERED'
                    ), 0
                ) as total_sold
            FROM products p
            WHERE p.farmer_id = $1
            ORDER BY p.product_name ASC
        `, [farmerId]);
        
        console.log(`Found ${farmerProducts.rows.length} products`);
        console.log('Products:', farmerProducts.rows.map(p => p.product_name));
        
        // Calculate totals
        const totalProducts = farmerProducts.rows.length;
        const totalSold = farmerProducts.rows.reduce((sum, p) => sum + parseInt(p.total_sold), 0);
        const topProduct = farmerProducts.rows[0]?.product_name || 'None';
        
        res.json({
            success: true,
            products: farmerProducts.rows,
            summary: {
                total_products: totalProducts,
                total_sales: totalSold,
                top_product: topProduct
            }
        });
        
    } catch (error) {
        console.error('Farm performance error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================== 2. WHAT TO PLANT (WITH RANDOM FOREST ML) =====================
router.get('/what-to-plant', authenticateToken, async (req, res) => {
    try {
        const currentMonth = new Date().getMonth() + 1;
        const currentSeason = getCurrentSeason();
        
        const seasonalProducts = await pool.query(`
            SELECT 
                product_name,
                demand_score,
                planting_months,
                expected_price,
                notes
            FROM seasonal_planting_guide
            WHERE season = $1
            ORDER BY demand_score DESC
        `, [currentSeason]);
        
        const mlPredictions = [];
        for (const product of seasonalProducts.rows) {
            const marketData = await pool.query(`
                SELECT total_sales, search_frequency, price_range_min as price
                FROM market_product_demand
                WHERE LOWER(product_name) = LOWER($1)
            `, [product.product_name]);
            
            let mlScore = product.demand_score;
            
            if (marketData.rows.length > 0) {
                try {
                    mlScore = await randomForest.predictDemandScore({
                        total_sales: marketData.rows[0].total_sales,
                        search_frequency: marketData.rows[0].search_frequency,
                        price: marketData.rows[0].price
                    });
                } catch (err) {
                    console.error(`ML prediction failed for ${product.product_name}:`, err.message);
                    mlScore = product.demand_score;
                }
            }
            
            const minMonth = Math.min(...product.planting_months);
            const maxMonth = Math.max(...product.planting_months);
            let plantingStatus = '';
            if (currentMonth >= minMonth && currentMonth <= maxMonth) {
                plantingStatus = '🌱 Best time to plant now!';
            } else if (currentMonth < minMonth) {
                plantingStatus = `📅 Prepare for planting in ${getMonthName(minMonth)}`;
            } else {
                plantingStatus = '📋 Plan for next season';
            }
            
            mlPredictions.push({
                product_name: product.product_name,
                demand_score: Math.round(mlScore * 10) / 10,
                planting_months: product.planting_months,
                month_names: product.planting_months.map(m => getMonthName(m)),
                expected_price: product.expected_price,
                notes: product.notes || 'High demand product',
                planting_status: plantingStatus,
                ml_insight: mlScore >= 7 ? '🔥 ML predicts HIGH demand' : 
                           mlScore >= 5 ? '📈 ML predicts MEDIUM demand' : 
                           '📊 ML predicts LOW demand'
            });
        }
        
        mlPredictions.sort((a, b) => b.demand_score - a.demand_score);
        
        res.json({
            success: true,
            season: currentSeason,
            current_month: currentMonth,
            recommendations: mlPredictions,
            ml_model: randomForest.isTrained ? "Random Forest Regression" : "Fallback Formula"
        });
        
    } catch (error) {
        console.error('What to plant error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================== 3. WHAT TO SELL =====================
router.get('/what-to-sell', authenticateToken, async (req, res) => {
    try {
        const currentSeason = getCurrentSeason();
        
        const marketProducts = await pool.query(`
            SELECT 
                product_name,
                category,
                base_demand_score,
                price_range_min,
                price_range_max,
                search_frequency,
                total_sales
            FROM market_product_demand
            WHERE season = $1 OR season = 'Year-round'
            ORDER BY base_demand_score DESC
        `, [currentSeason]);
        
        const mlProducts = [];
        for (const product of marketProducts.rows) {
            let mlScore = product.base_demand_score;
            
            try {
                mlScore = await randomForest.predictDemandScore({
                    total_sales: product.total_sales,
                    search_frequency: product.search_frequency,
                    price: (product.price_range_min + product.price_range_max) / 2
                });
            } catch (err) {
                console.error(`ML prediction failed for ${product.product_name}:`, err.message);
                mlScore = product.base_demand_score;
            }
            
            mlProducts.push({
                product_name: product.product_name,
                category: product.category,
                demand_score: Math.round(mlScore * 10) / 10,
                price_range_min: product.price_range_min,
                price_range_max: product.price_range_max,
                search_frequency: product.search_frequency || 0,
                total_sales: product.total_sales,
                demand_level: mlScore >= 7 ? 'High Demand' : mlScore >= 5 ? 'Medium Demand' : 'Low Demand',
                ml_insight: mlScore >= 7 ? '🔥 ML: STRONG OPPORTUNITY' : 
                           mlScore >= 5 ? '📈 ML: Good Opportunity' : 
                           'ℹ️ ML: Monitor Market'
            });
        }
        
        mlProducts.sort((a, b) => b.demand_score - a.demand_score);
        
        res.json({
            success: true,
            season: currentSeason,
            products: mlProducts,
            ml_model: randomForest.isTrained ? "Random Forest Regression" : "Fallback Formula"
        });
        
    } catch (error) {
        console.error('What to sell error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================== 4. PERSONALIZED INSIGHTS (FIXED) =====================
router.get('/personalized-insights', authenticateToken, authorizeRole('FARMER'), async (req, res) => {
    try {
        const userId = req.user.user_id || req.user.id;
        
        // Get farmer_id from user_id
        const farmerQuery = await pool.query(`
            SELECT farmer_id FROM farmers WHERE user_id = $1
        `, [userId]);
        
        if (farmerQuery.rows.length === 0) {
            return res.json({
                success: true,
                recommendations: [],
                farmer_summary: {
                    total_products: 0,
                    products_grown: [],
                    existing_count: 0,
                    high_priority_count: 0,
                    new_opportunities_count: 0,
                    total_recommendations: 0
                }
            });
        }
        
        const farmerId = farmerQuery.rows[0].farmer_id;
        
        // Get ALL farmer's existing products
        const farmerProducts = await pool.query(`
            SELECT 
                product_id,
                product_name,
                LOWER(TRIM(product_name)) as normalized_name,
                price,
                category
            FROM products 
            WHERE farmer_id = $1
            ORDER BY product_name ASC
        `, [farmerId]);
        
        const farmerProductNames = farmerProducts.rows.map(p => p.normalized_name);
        
        // Get ALL market products
        const marketProducts = await pool.query(`
            SELECT 
                product_name,
                LOWER(TRIM(product_name)) as normalized_name,
                base_demand_score,
                price_range_min,
                price_range_max,
                total_sales,
                search_frequency
            FROM market_product_demand
            ORDER BY base_demand_score DESC
        `);
        
        const recommendations = [];
        
        for (const market of marketProducts.rows) {
            const marketNormalized = market.normalized_name;
            
            // Check if farmer already grows this product
            let farmerGrows = farmerProductNames.includes(marketNormalized);
            let matchedProduct = farmerProducts.rows.find(p => p.normalized_name === marketNormalized);
            
            // Calculate ML demand score
            let mlScore = market.base_demand_score;
            
            try {
                mlScore = await randomForest.predictDemandScore({
                    total_sales: market.total_sales || 0,
                    search_frequency: market.search_frequency || 0,
                    price: (market.price_range_min + market.price_range_max) / 2
                });
            } catch (err) {
                mlScore = market.base_demand_score;
            }
            
            // Round to 1 decimal
            const finalScore = Math.round(mlScore * 10) / 10;
            
            // Determine priority (for backend use)
            let priority = finalScore >= 7 ? 'HIGH' : (finalScore >= 5 ? 'MEDIUM' : 'LOW');
            
            // Determine action
            let action = '';
            let type = farmerGrows ? 'existing' : 'new';
            
            if (farmerGrows) {
                action = finalScore >= 7 ? 'Start selling now!' : (finalScore >= 5 ? 'Good opportunity' : 'Monitor market');
            } else {
                action = finalScore >= 7 ? '🌱 Add to farm!' : (finalScore >= 5 ? '📈 Consider adding' : 'ℹ️ Monitor');
            }
            
            recommendations.push({
                product_name: market.product_name,
                type: type,
                demand_score: finalScore,
                market_price: `₱${market.price_range_min} - ₱${market.price_range_max}`,
                market_sales: market.total_sales || 0,
                action: action,
                priority: priority
            });
        }
        
        recommendations.sort((a, b) => b.demand_score - a.demand_score);
        
        // ACCURATE COUNTS
        const farmerActualProducts = farmerProducts.rows.length; // Farmer's actual products
        const existingCount = recommendations.filter(r => r.type === 'existing').length;
        const highPriorityCount = recommendations.filter(r => r.demand_score >= 7).length;
        const newOpportunitiesCount = recommendations.filter(r => r.type === 'new' && r.demand_score >= 7).length;
        
        console.log('=== ACCURATE COUNTS ===');
        console.log('Farmer Actual Products:', farmerActualProducts);
        console.log('Existing Products in Market:', existingCount);
        console.log('High Priority (score >= 7):', highPriorityCount);
        console.log('New Opportunities (new + score >= 7):', newOpportunitiesCount);
        
        res.json({
            success: true,
            recommendations: recommendations,
            farmer_summary: {
                total_products: farmerActualProducts,  // Farmer's actual product count
                products_grown: farmerProducts.rows.map(p => p.product_name),
                existing_count: existingCount,
                high_priority_count: highPriorityCount,
                new_opportunities_count: newOpportunitiesCount,
                total_recommendations: recommendations.length
            }
        });
        
    } catch (error) {
        console.error('Personalized insights error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================== ML MODEL STATUS =====================
router.get('/ml-status', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const marketCount = await pool.query('SELECT COUNT(*) FROM market_product_demand');
        const seasonalCount = await pool.query('SELECT COUNT(*) FROM seasonal_planting_guide');
        
        res.json({
            success: true,
            ml_model: {
                is_trained: randomForest.isTrained,
                type: "Random Forest Regression",
                features: ["Total Sales", "Search Frequency", "Price"]
            },
            data_status: {
                market_products: parseInt(marketCount.rows[0].count),
                seasonal_guides: parseInt(seasonalCount.rows[0].count),
                has_data: parseInt(marketCount.rows[0].count) > 0
            }
        });
        
    } catch (error) {
        console.error('ML status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================== FORCE RETRAIN ML MODEL =====================
router.post('/retrain-ml', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const success = await randomForest.trainModel();
        
        res.json({
            success: true,
            message: success ? 'Random Forest model retrained successfully' : 'Training failed',
            is_trained: randomForest.isTrained
        });
        
    } catch (error) {
        console.error('Retrain ML error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================== CHECK DATA STATUS =====================
router.get('/data-status', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const marketData = await pool.query('SELECT COUNT(*) FROM market_product_demand');
        const seasonalData = await pool.query('SELECT COUNT(*) FROM seasonal_planting_guide');
        
        const sample = await pool.query(`
            SELECT product_name, total_sales, search_frequency, base_demand_score
            FROM market_product_demand
            LIMIT 5
        `);
        
        res.json({
            success: true,
            market_products_count: parseInt(marketData.rows[0].count),
            seasonal_guides_count: parseInt(seasonalData.rows[0].count),
            sample_data: sample.rows,
            ml_ready: randomForest.isTrained,
            recommendation: parseInt(marketData.rows[0].count) > 0 ? 
                "System ready. Run /retrain-ml to train model." : 
                "No market data found. Run import-market-reference.js first."
        });
        
    } catch (error) {
        console.error('Data status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;