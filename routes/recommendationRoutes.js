const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');
const pool = require('../config/database');
const demandPredictor = require('../services/ml/simpleDemandPredictor');

// GET /api/recommendations/demand-analysis - Farmer only
router.get('/demand-analysis', authenticateToken, authorizeRole('FARMER'), async (req, res) => {
    try {
        console.log('=== DEMAND ANALYSIS DEBUG ===');
        console.log('req.user:', req.user);
        
        // Get user ID from req.user (now consistently set by auth middleware)
        const userId = req.user.id;
        console.log('User ID from JWT:', userId);
        
        if (!userId) {
            console.log('No user ID found in token');
            return res.status(401).json({ 
                success: false, 
                error: 'User ID not found in token' 
            });
        }
        
        // Try to get farmer_id from farmers table
        let farmerId = userId; // Default to using userId directly
        
        try {
            const farmerQuery = await pool.query(
                'SELECT farmer_id FROM farmers WHERE user_id = $1',
                [userId]
            );
            
            if (farmerQuery.rows.length > 0) {
                farmerId = farmerQuery.rows[0].farmer_id;
                console.log('Found farmer_id in farmers table:', farmerId);
            } else {
                console.log('No farmer record found, using user_id as farmer_id:', userId);
            }
        } catch (dbError) {
            console.log('Error querying farmers table:', dbError.message);
            console.log('Falling back to using user_id as farmer_id');
        }

        // Get farmer's products with their stats
        const query = `
            SELECT 
                p.product_id as id,
                p.product_name as name,
                p.price,
                p.view_count,
                p.category as category_name,
                COALESCE(SUM(oi.quantity), 0) as times_sold
            FROM products p
            LEFT JOIN order_items oi ON oi.product_id = p.product_id
            LEFT JOIN orders o ON o.order_id = oi.order_id AND o.order_status = 'DELIVERED'
            WHERE p.farmer_id = $1
            GROUP BY p.product_id, p.product_name, p.price, p.view_count, p.category
        `;
        
        const result = await pool.query(query, [farmerId]);
        const products = result.rows;
        
        console.log(`Found ${products.length} products for farmer_id ${farmerId}`);

        if (!products.length) {
            return res.json({
                success: true,
                demand_analysis: []
            });
        }

        // Format products for prediction
        const productsForPrediction = products.map(p => ({
            id: p.id,
            name: p.name,
            view_count: parseInt(p.view_count) || 0,
            times_sold: parseInt(p.times_sold) || 0,
            price: parseFloat(p.price) || 0
        }));

        // Get demand predictions
        const demandAnalysis = await demandPredictor.predictBulkDemand(productsForPrediction);

        // Sort by demand score
        demandAnalysis.sort((a, b) => b.demand_score - a.demand_score);

        // Format response
        const formattedAnalysis = demandAnalysis.map(p => ({
            product_id: p.id,
            product_name: p.name,
            category: products.find(prod => prod.id === p.id)?.category_name || 'Uncategorized',
            demand_score: p.demand_score,
            freq_c: p.view_count || 0,
            times_sold: p.times_sold || 0
        }));

        res.json({
            success: true,
            demand_analysis: formattedAnalysis
        });

    } catch (error) {
        console.error('Demand analysis error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// GET /api/recommendations/market-insights - Farmer only
router.get('/market-insights', authenticateToken, authorizeRole('FARMER'), async (req, res) => {
    try {
        // Get top performing products across all farmers
        const query = `
            SELECT 
                p.product_id as id,
                p.product_name as name,
                p.view_count,
                p.category as category_name,
                u.full_name as farmer_name,
                COALESCE(SUM(oi.quantity), 0) as times_sold
            FROM products p
            LEFT JOIN users u ON u.user_id = p.farmer_id
            LEFT JOIN order_items oi ON oi.product_id = p.product_id
            LEFT JOIN orders o ON o.order_id = oi.order_id AND o.order_status = 'DELIVERED'
            GROUP BY p.product_id, p.product_name, p.view_count, p.category, u.full_name
            ORDER BY (p.view_count + COALESCE(SUM(oi.quantity), 0) * 10) DESC
            LIMIT 10
        `;
        
        const result = await pool.query(query);
        const products = result.rows;

        const insights = await Promise.all(products.map(async (product) => {
            // Create product object for prediction
            const productObj = {
                view_count: parseInt(product.view_count) || 0,
                times_sold: parseInt(product.times_sold) || 0,
                price: 0
            };
            
            const demandScore = await demandPredictor.predictDemand(productObj);
            
            return {
                product_name: product.name,
                category: product.category_name || 'Uncategorized',
                demand_score: demandScore.toFixed(1),
                view_count: parseInt(product.view_count) || 0,
                farmer: product.farmer_name || 'Unknown'
            };
        }));

        res.json({
            success: true,
            insights: insights
        });

    } catch (error) {
        console.error('Market insights error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// GET /api/recommendations/seasonal - Public (no auth needed)
router.get('/seasonal', async (req, res) => {
    try {
        const currentMonth = new Date().getMonth() + 1;
        const season = currentMonth >= 3 && currentMonth <= 6 ? 'dry' : 'wet';
        
        const PHILIPPINE_SEASONS = {
            'dry': {
                name: 'Dry Season (Tag-araw)',
                icon: 'fa-sun',
                description: 'Hot and dry weather, perfect for sun-loving crops',
                recommendations: ['Watermelon', 'Mango', 'Corn', 'Squash', 'Cucumber',
                    'Sili', 'Talong', 'String Beans', 'Okra', 'Kalabasa', 'Ampalaya',
                    'Pipino', 'Langka', 'Saging', 'Papaya']
            },
            'wet': {
                name: 'Wet Season (Tag-ulan)',
                icon: 'fa-cloud-rain',
                description: 'Rainy weather, ideal for leafy vegetables',
                recommendations: ['Rice', 'Pechay', 'Kangkong', 'Mustasa', 'Lettuce',
                    'Cabbage', 'Cauliflower', 'Broccoli', 'Patola', 'Talong',
                    'Labanos', 'Saluyot', 'Alugbati', 'Gabi', 'Ube', 'Kamote',
                    'Saging', 'Papaya', 'Okra', 'Sitaw', 'Ampalaya', 'Upo',
                    'Kamatis', 'Talbos ng Kamote', 'Luya', 'Singkamas']
            }
        };
        
        res.json({
            success: true,
            season: season,
            current_season: PHILIPPINE_SEASONS[season].name,
            description: PHILIPPINE_SEASONS[season].description,
            recommendations: PHILIPPINE_SEASONS[season].recommendations
        });
    } catch (error) {
        console.error('Seasonal error:', error);
        res.status(500).json({ error: error.message });
    }
});

// NEW: GET /api/recommendations/personalized - Customer personalized recommendations
router.get('/personalized', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                error: 'User ID not found in token' 
            });
        }

        // Get user's recently viewed products
        const viewedQuery = `
            SELECT 
                p.product_id,
                p.product_name,
                p.price,
                p.description,
                p.image_url,
                p.category,
                p.farmer_id,
                f.farm_name,
                f.farm_location,
                pv.viewed_at
            FROM product_views pv
            JOIN products p ON pv.product_id = p.product_id
            JOIN farmers f ON p.farmer_id = f.farmer_id
            WHERE pv.user_id = $1
            ORDER BY pv.viewed_at DESC
            LIMIT 8
        `;
        
        // Get similar products based on viewed categories and user preferences
        const similarQuery = `
            SELECT 
                p.product_id,
                p.product_name,
                p.price,
                p.description,
                p.image_url,
                p.category,
                p.farmer_id,
                f.farm_name,
                f.farm_location,
                COALESCE(p.view_count, 0) as popularity_score,
                CASE 
                    WHEN p.product_id IN (
                        SELECT product_id FROM order_items oi
                        JOIN orders o ON oi.order_id = o.order_id
                        WHERE o.user_id = $1
                    ) THEN 1 ELSE 0 
                END as purchased_before
            FROM products p
            JOIN farmers f ON p.farmer_id = f.farmer_id
            WHERE p.status = 'AVAILABLE'
            AND p.category IN (
                SELECT DISTINCT category 
                FROM product_views pv
                JOIN products p ON pv.product_id = p.product_id
                WHERE pv.user_id = $1
                UNION
                SELECT DISTINCT p.category
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.order_id
                JOIN products p ON oi.product_id = p.product_id
                WHERE o.user_id = $1 AND o.order_status = 'DELIVERED'
            )
            AND p.product_id NOT IN (
                SELECT product_id FROM product_views WHERE user_id = $1
            )
            ORDER BY 
                purchased_before DESC,
                popularity_score DESC,
                RANDOM()
            LIMIT 8
        `;
        
        // Get trending products (high views/purchases in last 7 days)
        const trendingQuery = `
            SELECT 
                p.product_id,
                p.product_name,
                p.price,
                p.description,
                p.image_url,
                p.category,
                p.farmer_id,
                f.farm_name,
                f.farm_location,
                COUNT(DISTINCT pv.view_id) as recent_views,
                COUNT(DISTINCT oi.order_item_id) as recent_purchases
            FROM products p
            JOIN farmers f ON p.farmer_id = f.farmer_id
            LEFT JOIN product_views pv ON p.product_id = pv.product_id 
                AND pv.viewed_at > CURRENT_DATE - INTERVAL '7 days'
            LEFT JOIN order_items oi ON p.product_id = oi.product_id
            LEFT JOIN orders o ON oi.order_id = o.order_id
                AND o.order_date > CURRENT_DATE - INTERVAL '7 days'
                AND o.order_status IN ('COMPLETED', 'DELIVERED')
            WHERE p.status = 'AVAILABLE'
            GROUP BY p.product_id, f.farm_name, f.farm_location
            HAVING COUNT(DISTINCT pv.view_id) > 0 OR COUNT(DISTINCT oi.order_item_id) > 0
            ORDER BY (COUNT(DISTINCT pv.view_id) * 0.4 + COUNT(DISTINCT oi.order_item_id) * 0.6) DESC
            LIMIT 8
        `;

        // Get also bought products (based on order history)
        const alsoBoughtQuery = `
            WITH user_orders AS (
                SELECT DISTINCT order_id 
                FROM orders 
                WHERE user_id = $1 AND order_status = 'DELIVERED'
            ),
            user_products AS (
                SELECT DISTINCT oi.product_id
                FROM order_items oi
                JOIN user_orders uo ON oi.order_id = uo.order_id
            ),
            also_bought AS (
                SELECT 
                    oi2.product_id,
                    COUNT(*) as times_bought_together
                FROM user_products up
                JOIN order_items oi1 ON up.product_id = oi1.product_id
                JOIN order_items oi2 ON oi1.order_id = oi2.order_id 
                    AND oi2.product_id != up.product_id
                GROUP BY oi2.product_id
                ORDER BY times_bought_together DESC
                LIMIT 8
            )
            SELECT 
                p.product_id,
                p.product_name,
                p.price,
                p.description,
                p.image_url,
                p.category,
                p.farmer_id,
                f.farm_name,
                f.farm_location,
                ab.times_bought_together
            FROM also_bought ab
            JOIN products p ON ab.product_id = p.product_id
            JOIN farmers f ON p.farmer_id = f.farmer_id
            WHERE p.status = 'AVAILABLE'
            ORDER BY ab.times_bought_together DESC
        `;

        // Execute all queries in parallel
        const [viewedResult, similarResult, trendingResult, alsoBoughtResult] = await Promise.all([
            pool.query(viewedQuery, [userId]),
            pool.query(similarQuery, [userId]),
            pool.query(trendingQuery),
            pool.query(alsoBoughtQuery, [userId])
        ]);

        res.json({
            success: true,
            recommendations: {
                recently_viewed: viewedResult.rows,
                similar_products: similarResult.rows,
                trending_products: trendingResult.rows,
                frequently_bought_together: alsoBoughtResult.rows
            },
            metadata: {
                user_id: userId,
                generated_at: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Personalized recommendations error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// POST /api/recommendations/retrain - Admin only
router.post('/retrain', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const success = await demandPredictor.trainModel();
        
        res.json({
            success: true,
            message: success ? 'Model retrained successfully' : 'Training failed - insufficient data'
        });

    } catch (error) {
        console.error('Retrain error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;