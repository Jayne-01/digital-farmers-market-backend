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