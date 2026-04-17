// controllers/productController.js
const db = require('../config/database');
const Farmer = require('../models/farmerModel');
const Product = require('../models/productModel');

console.log('✅ Product controller loaded');

// ========== NEW: SEARCH TRACKING FUNCTIONS ==========

// Track search query
const trackSearch = async (req, res) => {
    try {
        const { search_term, product_id } = req.body;
        const user_id = req.user.user_id || req.user.id;
        
        if (!search_term || search_term.trim().length < 2) {
            return res.status(400).json({ 
                success: false, 
                error: 'Search term is required and must be at least 2 characters' 
            });
        }
        
        // Insert into product_searches table
        const insertQuery = `
            INSERT INTO product_searches (search_term, product_id, user_id, searched_at)
            VALUES ($1, $2, $3, NOW())
            RETURNING search_id
        `;
        
        const result = await db.query(insertQuery, [search_term.trim(), product_id || null, user_id]);
        
        // Also update product's view_count if product_id is provided
        if (product_id) {
            await db.query(
                `UPDATE products SET view_count = COALESCE(view_count, 0) + 1 
                 WHERE product_id = $1`,
                [product_id]
            );
        }
        
        console.log(`✅ Search tracked: "${search_term}" by user ${user_id}`);
        
        res.json({ 
            success: true, 
            message: 'Search tracked successfully',
            search_id: result.rows[0].search_id
        });
    } catch (error) {
        console.error('Error tracking search:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Get trending searches
const getTrendingSearches = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        
        const query = `
            SELECT 
                search_term,
                COUNT(*) as search_count,
                MAX(searched_at) as last_searched
            FROM product_searches
            WHERE searched_at > NOW() - INTERVAL '7 days'
            GROUP BY search_term
            ORDER BY search_count DESC
            LIMIT $1
        `;
        
        const result = await db.query(query, [limit]);
        
        res.json({ 
            success: true, 
            trending: result.rows 
        });
    } catch (error) {
        console.error('Error getting trending searches:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Get most viewed products (by view_count)
const getMostViewedProducts = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        
        const query = `
            SELECT 
                p.product_id,
                p.product_name,
                p.price,
                p.category,
                p.image_url,
                p.unit,
                p.stock,
                p.status,
                COALESCE(p.view_count, 0) as view_count,
                COALESCE(p.average_rating, 0) as average_rating,
                COALESCE(p.total_reviews, 0) as review_count,
                p.description,
                f.farm_name,
                f.barangay,
                f.farmer_id
            FROM products p
            LEFT JOIN farmers f ON p.farmer_id = f.farmer_id
            WHERE p.status = 'AVAILABLE' AND p.stock > 0
            ORDER BY COALESCE(p.view_count, 0) DESC
            LIMIT $1
        `;
        
        const result = await db.query(query, [limit]);
        
        res.json({ 
            success: true, 
            products: result.rows 
        });
    } catch (error) {
        console.error('Error getting most viewed products:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Get top rated products
const getTopRatedProducts = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const minReviews = parseInt(req.query.minReviews) || 3;
        
        const query = `
            SELECT 
                p.product_id,
                p.product_name,
                p.price,
                p.category,
                p.image_url,
                p.unit,
                p.stock,
                p.status,
                COALESCE(p.view_count, 0) as view_count,
                COALESCE(p.average_rating, 0) as average_rating,
                COALESCE(p.total_reviews, 0) as review_count,
                p.description,
                f.farm_name,
                f.barangay,
                f.farmer_id
            FROM products p
            LEFT JOIN farmers f ON p.farmer_id = f.farmer_id
            WHERE p.status = 'AVAILABLE' 
              AND p.stock > 0
              AND COALESCE(p.total_reviews, 0) >= $2
            ORDER BY COALESCE(p.average_rating, 0) DESC, COALESCE(p.total_reviews, 0) DESC
            LIMIT $1
        `;
        
        const result = await db.query(query, [limit, minReviews]);
        
        res.json({ 
            success: true, 
            products: result.rows 
        });
    } catch (error) {
        console.error('Error getting top rated products:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Get trending products (combines view_count and rating)
const getTrendingProducts = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 12;
        
        const query = `
            SELECT 
                p.product_id,
                p.product_name,
                p.price,
                p.category,
                p.image_url,
                p.unit,
                p.stock,
                p.status,
                p.view_count,
                p.average_rating,
                p.total_reviews,
                p.description,
                f.farm_name,
                f.barangay,
                f.farmer_id,
                (COALESCE(p.view_count, 0) * 0.7 + COALESCE(p.average_rating, 0) * 30) as trending_score
            FROM products p
            LEFT JOIN farmers f ON p.farmer_id = f.farmer_id
            WHERE p.status = 'AVAILABLE' AND p.stock > 0
            ORDER BY trending_score DESC
            LIMIT $1
        `;
        
        const result = await db.query(query, [limit]);
        
        res.json({ 
            success: true, 
            products: result.rows 
        });
    } catch (error) {
        console.error('Error getting trending products:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Get search statistics for admin
const getSearchStats = async (req, res) => {
    try {
        // Get overall search stats
        const overallStats = await db.query(`
            SELECT 
                COUNT(*) as total_searches,
                COUNT(DISTINCT search_term) as unique_terms,
                COUNT(DISTINCT user_id) as unique_searchers
            FROM product_searches
            WHERE searched_at > NOW() - INTERVAL '30 days'
        `);
        
        // Get top searched terms all time
        const topTerms = await db.query(`
            SELECT 
                search_term,
                COUNT(*) as search_count
            FROM product_searches
            GROUP BY search_term
            ORDER BY search_count DESC
            LIMIT 20
        `);
        
        // Get search activity by day (last 7 days)
        const dailyActivity = await db.query(`
            SELECT 
                DATE(searched_at) as date,
                COUNT(*) as search_count
            FROM product_searches
            WHERE searched_at > NOW() - INTERVAL '7 days'
            GROUP BY DATE(searched_at)
            ORDER BY date ASC
        `);
        
        // Get most viewed products
        const mostViewed = await db.query(`
            SELECT 
                product_name,
                view_count,
                average_rating,
                total_reviews
            FROM products
            WHERE view_count > 0
            ORDER BY view_count DESC
            LIMIT 10
        `);
        
        res.json({ 
            success: true, 
            stats: {
                overall: overallStats.rows[0],
                top_terms: topTerms.rows,
                daily_activity: dailyActivity.rows,
                most_viewed_products: mostViewed.rows
            }
        });
    } catch (error) {
        console.error('Error getting search stats:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ========== EXISTING FUNCTIONS ==========

// Get farmer's own products (for product management)
const getFarmerProducts = async (req, res) => {
    try {
        console.log('Getting products for farmer, user ID:', req.user.user_id);
        
        // Get farmer_id from the authenticated user
        const farmerResult = await Farmer.findByUserId(req.user.user_id);
        
        if (farmerResult.rows.length === 0) {
            return res.status(403).json({ 
                success: false, 
                error: 'User is not a registered farmer' 
            });
        }

        const farmer_id = farmerResult.rows[0].farmer_id;
        console.log('Farmer ID:', farmer_id);

        // Get ONLY this farmer's products with stock information
        const query = `
            SELECT 
                p.*,
                COUNT(DISTINCT oi.order_item_id) as times_sold,
                p.stock as current_stock,
                p.sold_count as total_sold
            FROM products p
            LEFT JOIN order_items oi ON p.product_id = oi.product_id
            WHERE p.farmer_id = $1
            GROUP BY p.product_id
            ORDER BY p.created_at DESC
        `;

        const result = await db.query(query, [farmer_id]);
        
        console.log(`Found ${result.rows.length} products for farmer ${farmer_id}`);
        
        res.json({
            success: true,
            products: result.rows,
            count: result.rows.length
        });

    } catch (error) {
        console.error('Get farmer products error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error',
            details: error.message 
        });
    }
};

// Get all products (public) - FIXED with proper feedback counting and sorting
const getAllProducts = async (req, res) => {
    try {
        const { category, barangay, minPrice, maxPrice, sort, page = 1, limit = 12 } = req.query;
        
        const offset = (page - 1) * limit;
        
        // Build query with filters - FIXED to use feedback table instead of reviews
        let query = `
            SELECT 
                p.*,
                f.farmer_id,
                f.farm_name,
                f.barangay,
                u.full_name as farmer_name,
                COALESCE((SELECT AVG(fb.rating)::numeric(10,2) FROM feedback fb WHERE fb.product_id = p.product_id), 0) as avg_rating,
                COALESCE((SELECT COUNT(*) FROM feedback fb WHERE fb.product_id = p.product_id), 0) as review_count
            FROM products p
            JOIN farmers f ON p.farmer_id = f.farmer_id
            JOIN users u ON f.user_id = u.user_id
            WHERE p.status = 'AVAILABLE'
        `;
        
        const queryParams = [];
        let paramCount = 1;
        
        if (category) {
            query += ` AND p.category = $${paramCount}`;
            queryParams.push(category);
            paramCount++;
        }
        
        if (barangay) {
            query += ` AND f.barangay = $${paramCount}`;
            queryParams.push(barangay);
            paramCount++;
        }
        
        if (minPrice) {
            query += ` AND p.price >= $${paramCount}`;
            queryParams.push(minPrice);
            paramCount++;
        }
        
        if (maxPrice) {
            query += ` AND p.price <= $${paramCount}`;
            queryParams.push(maxPrice);
            paramCount++;
        }
        
        // Sorting - FIXED to avoid ambiguous column references
        switch (sort) {
            case 'price_low':
                query += ' ORDER BY p.price ASC';
                break;
            case 'price_high':
                query += ' ORDER BY p.price DESC';
                break;
            case 'popular':
                query += ' ORDER BY p.view_count DESC, p.created_at DESC';
                break;
            case 'top_rated':
                query += ' ORDER BY (SELECT AVG(fb.rating) FROM feedback fb WHERE fb.product_id = p.product_id) DESC NULLS LAST, (SELECT COUNT(*) FROM feedback fb WHERE fb.product_id = p.product_id) DESC, p.created_at DESC';
                break;
            default:
                query += ' ORDER BY p.created_at DESC';
        }
        
        query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        queryParams.push(parseInt(limit), parseInt(offset));
        
        console.log('Executing query with params:', queryParams);
        const result = await db.query(query, queryParams);
        
        // Get total count for pagination
        const countQuery = 'SELECT COUNT(*) FROM products WHERE status = $1';
        const countResult = await db.query(countQuery, ['AVAILABLE']);
        const total = parseInt(countResult.rows[0].count);

        // Transform the results to use average_rating for frontend consistency
        const products = result.rows.map(product => ({
            ...product,
            average_rating: product.avg_rating
        }));

        // Log rating data for debugging
        console.log(`Found ${products.length} products`);
        if (products.length > 0) {
            products.forEach((product, index) => {
                console.log(`Product ${index + 1}: ${product.product_name} - Rating: ${product.average_rating}, Reviews: ${product.review_count}`);
            });
        }

        res.json({
            success: true,
            products: products,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('Get all products error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
};

// Search products (public) - FIXED with proper feedback counting
const searchProducts = async (req, res) => {
    try {
        const { query: searchQuery, category, minPrice, maxPrice } = req.query;
        
        if (!searchQuery) {
            return res.status(400).json({ 
                success: false, 
                error: 'Search query is required' 
            });
        }

        let sql = `
            SELECT 
                p.*,
                f.farmer_id,
                f.farm_name,
                f.barangay,
                u.full_name as farmer_name,
                COALESCE((SELECT AVG(fb.rating)::numeric(10,2) FROM feedback fb WHERE fb.product_id = p.product_id), 0) as avg_rating,
                COALESCE((SELECT COUNT(*) FROM feedback fb WHERE fb.product_id = p.product_id), 0) as review_count
            FROM products p
            JOIN farmers f ON p.farmer_id = f.farmer_id
            JOIN users u ON f.user_id = u.user_id
            WHERE p.status = 'AVAILABLE' 
            AND (p.product_name ILIKE $1 OR p.description ILIKE $1)
        `;
        
        const params = [`%${searchQuery}%`];
        let paramCount = 2;
        
        if (category) {
            sql += ` AND p.category = $${paramCount}`;
            params.push(category);
            paramCount++;
        }
        
        if (minPrice) {
            sql += ` AND p.price >= $${paramCount}`;
            params.push(minPrice);
            paramCount++;
        }
        
        if (maxPrice) {
            sql += ` AND p.price <= $${paramCount}`;
            params.push(maxPrice);
            paramCount++;
        }
        
        sql += ' ORDER BY p.view_count DESC, p.created_at DESC LIMIT 20';
        
        const result = await db.query(sql, params);
        
        // Transform the results
        const products = result.rows.map(product => ({
            ...product,
            average_rating: product.avg_rating
        }));
        
        console.log(`Search found ${products.length} products`);
        
        res.json({
            success: true,
            products: products,
            count: products.length
        });

    } catch (error) {
        console.error('Search products error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
};

// Get products by category (public) - FIXED with proper feedback counting
const getProductsByCategory = async (req, res) => {
    try {
        const { category } = req.params;
        
        const query = `
            SELECT 
                p.*,
                f.farmer_id,
                f.farm_name,
                f.barangay,
                u.full_name as farmer_name,
                COALESCE((SELECT AVG(fb.rating)::numeric(10,2) FROM feedback fb WHERE fb.product_id = p.product_id), 0) as avg_rating,
                COALESCE((SELECT COUNT(*) FROM feedback fb WHERE fb.product_id = p.product_id), 0) as review_count
            FROM products p
            JOIN farmers f ON p.farmer_id = f.farmer_id
            JOIN users u ON f.user_id = u.user_id
            WHERE p.status = 'AVAILABLE' AND p.category = $1
            ORDER BY p.view_count DESC, p.created_at DESC
            LIMIT 20
        `;
        
        const result = await db.query(query, [category]);
        
        // Transform the results
        const products = result.rows.map(product => ({
            ...product,
            average_rating: product.avg_rating
        }));
        
        console.log(`Category ${category} found ${products.length} products`);
        
        res.json({
            success: true,
            products: products,
            count: products.length
        });

    } catch (error) {
        console.error('Get products by category error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
};

// Get ALL products by farmer ID (public) - FIXED with proper feedback counting
const getProductsByFarmerId = async (req, res) => {
    try {
        const { farmerId } = req.params;
        const { page = 1, limit = 50 } = req.query;
        
        console.log(`📦 Fetching ALL products for farmer ID: ${farmerId}, page: ${page}, limit: ${limit}`);
        
        if (!farmerId) {
            return res.status(400).json({
                success: false,
                message: 'Farmer ID is required'
            });
        }

        // Validate farmerId is a number
        const farmerIdNum = parseInt(farmerId);
        if (isNaN(farmerIdNum)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid farmer ID format'
            });
        }

        const offset = (page - 1) * limit;
        
        // First, check if farmer exists
        const farmerCheck = await db.query(
            'SELECT farmer_id, farm_name FROM farmers WHERE farmer_id = $1',
            [farmerIdNum]
        );
        
        if (farmerCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Farmer not found'
            });
        }
        
        const farmName = farmerCheck.rows[0].farm_name;
        
        // Get ALL products for this farmer with rating data - FIXED to use feedback table
        const query = `
            SELECT 
                p.*,
                f.farm_name,
                f.barangay,
                u.full_name as farmer_name,
                COALESCE((SELECT AVG(fb.rating)::numeric(10,2) FROM feedback fb WHERE fb.product_id = p.product_id), 0) as avg_rating,
                COALESCE((SELECT COUNT(*) FROM feedback fb WHERE fb.product_id = p.product_id), 0) as review_count
            FROM products p
            JOIN farmers f ON p.farmer_id = f.farmer_id
            JOIN users u ON f.user_id = u.user_id
            WHERE p.farmer_id = $1
            ORDER BY 
                CASE WHEN p.status = 'AVAILABLE' THEN 0 ELSE 1 END,
                p.view_count DESC,
                p.created_at DESC
            LIMIT $2 OFFSET $3
        `;
        
        const countQuery = `
            SELECT COUNT(*) as total 
            FROM products 
            WHERE farmer_id = $1
        `;
        
        const [productsResult, countResult] = await Promise.all([
            db.query(query, [farmerIdNum, limit, offset]),
            db.query(countQuery, [farmerIdNum])
        ]);
        
        // Transform the results
        const products = productsResult.rows.map(product => ({
            ...product,
            average_rating: product.avg_rating
        }));
        
        const total = parseInt(countResult.rows[0].total);
        const totalPages = Math.ceil(total / limit);
        
        console.log(`✅ Found ${products.length} products for farmer ${farmerIdNum} (${farmName}), total: ${total}`);
        
        // Log rating data for debugging
        if (products.length > 0) {
            products.forEach((product, index) => {
                console.log(`Product ${index + 1}: ${product.product_name} - Rating: ${product.average_rating}, Reviews: ${product.review_count}`);
            });
        }
        
        res.json({
            success: true,
            products: products,
            farmer: {
                farmer_id: farmerIdNum,
                farm_name: farmName
            },
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages,
                hasMore: page < totalPages
            }
        });
        
    } catch (error) {
        console.error('❌ Error in getProductsByFarmerId:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch farmer products',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get product by ID (public) - FIXED with proper feedback counting
const getProductById = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Validate id is a number
        const productId = parseInt(id);
        if (isNaN(productId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid product ID format' 
            });
        }
        
        const query = `
            SELECT 
                p.*,
                f.farmer_id,
                f.farm_name,
                f.barangay,
                u.full_name as farmer_name,
                COALESCE((SELECT AVG(fb.rating)::numeric(10,2) FROM feedback fb WHERE fb.product_id = p.product_id), 0) as avg_rating,
                COALESCE((SELECT COUNT(*) FROM feedback fb WHERE fb.product_id = p.product_id), 0) as review_count
            FROM products p
            JOIN farmers f ON p.farmer_id = f.farmer_id
            JOIN users u ON f.user_id = u.user_id
            WHERE p.product_id = $1
        `;
        
        const result = await db.query(query, [productId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Product not found' 
            });
        }

        // Transform the result
        const product = {
            ...result.rows[0],
            average_rating: result.rows[0].avg_rating
        };

        // Increment view count
        await db.query('UPDATE products SET view_count = view_count + 1 WHERE product_id = $1', [productId]);

        console.log(`Product ${productId}: ${product.product_name} - Rating: ${product.average_rating}, Reviews: ${product.review_count}`);

        res.json({
            success: true,
            product: product
        });

    } catch (error) {
        console.error('Get product by ID error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
};

// ========== CREATE PRODUCT - NO PRICE ROUNDING ==========
// Create new product (farmer only)
const createProduct = async (req, res) => {
    try {
        console.log('Creating product for user:', req.user.user_id);
        
        const farmerResult = await Farmer.findByUserId(req.user.user_id);
        
        if (farmerResult.rows.length === 0) {
            return res.status(403).json({ 
                success: false, 
                error: 'User is not a registered farmer' 
            });
        }

        const farmer_id = farmerResult.rows[0].farmer_id;
        const { product_name, category, price, unit, stock, harvest_date, description } = req.body;
        
        // NO PRICE ROUNDING - Keep exact value as entered
        const exactPrice = parseFloat(price);
        
        console.log('Received data:', { product_name, category, price: exactPrice, unit, stock, harvest_date, description });
        
        // Validate required fields
        if (!product_name || !category || !price || !unit || stock === undefined) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields: product_name, category, price, unit, and stock are required' 
            });
        }

        // Validate stock is a positive number
        if (parseInt(stock) < 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Stock cannot be negative' 
            });
        }

        // Handle image upload
        let image_url = null;
        if (req.file) {
            image_url = `/uploads/${req.file.filename}`;
            console.log('Image URL:', image_url);
        }

        const query = `
            INSERT INTO products (
                farmer_id, product_name, category, price, unit, stock,
                harvest_date, description, image_url, status, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'AVAILABLE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *
        `;

        const values = [farmer_id, product_name, category, exactPrice, unit, stock, harvest_date || null, description || null, image_url];
        const result = await db.query(query, values);
        
        console.log('Product created:', result.rows[0]);
        
        res.json({
            success: true,
            message: 'Product created successfully',
            product: result.rows[0]
        });

    } catch (error) {
        console.error('Create product error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error',
            details: error.message 
        });
    }
};

// ========== UPDATE PRODUCT - NO PRICE ROUNDING ==========
// Update product (farmer only)
const updateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Validate id is a number
        const productId = parseInt(id);
        if (isNaN(productId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid product ID format' 
            });
        }
        
        console.log('Updating product ID:', productId);
        console.log('Request body:', req.body);
        
        const farmerResult = await Farmer.findByUserId(req.user.user_id);
        
        if (farmerResult.rows.length === 0) {
            return res.status(403).json({ 
                success: false, 
                error: 'User is not a registered farmer' 
            });
        }

        const farmer_id = farmerResult.rows[0].farmer_id;

        // Verify product belongs to this farmer
        const checkQuery = 'SELECT product_id FROM products WHERE product_id = $1 AND farmer_id = $2';
        const checkResult = await db.query(checkQuery, [productId, farmer_id]);
        
        if (checkResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Product not found or not authorized' 
            });
        }

        // Get values from request body
        const product_name = req.body.product_name;
        const category = req.body.category;
        let price = req.body.price;
        const unit = req.body.unit;
        const stock = req.body.stock;
        const harvest_date = req.body.harvest_date;
        const description = req.body.description;
        const status = req.body.status;
        
        // NO PRICE ROUNDING - Keep exact value as entered
        if (price !== undefined) {
            price = parseFloat(price);
        }
        
        console.log('Extracted values:', {
            product_name,
            category,
            price,
            unit,
            stock,
            harvest_date,
            description,
            status
        });
        
        // Build dynamic update query
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (product_name !== undefined) {
            updates.push(`product_name = $${paramIndex++}`);
            values.push(product_name);
        }
        if (category !== undefined) {
            updates.push(`category = $${paramIndex++}`);
            values.push(category);
        }
        if (price !== undefined) {
            updates.push(`price = $${paramIndex++}`);
            values.push(price);
        }
        if (unit !== undefined) {
            console.log('Adding unit to update:', unit);
            updates.push(`unit = $${paramIndex++}`);
            values.push(unit);
        }
        if (stock !== undefined) {
            console.log('Adding stock to update:', stock);
            if (parseInt(stock) < 0) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Stock cannot be negative' 
                });
            }
            updates.push(`stock = $${paramIndex++}`);
            values.push(stock);
        }
        
        if (harvest_date !== undefined) {
            console.log('Adding harvest_date to update:', harvest_date);
            updates.push(`harvest_date = $${paramIndex++}`);
            values.push(harvest_date === '' ? null : harvest_date);
        }
        
        if (description !== undefined) {
            updates.push(`description = $${paramIndex++}`);
            values.push(description);
        }
        if (status !== undefined) {
            updates.push(`status = $${paramIndex++}`);
            values.push(status);
        }
        
        // Handle image update
        if (req.file) {
            const image_url = `/uploads/${req.file.filename}`;
            updates.push(`image_url = $${paramIndex++}`);
            values.push(image_url);
            console.log('Adding image_url to update:', image_url);
        }

        updates.push(`updated_at = CURRENT_TIMESTAMP`);

        if (updates.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'No fields to update' 
            });
        }

        const query = `
            UPDATE products 
            SET ${updates.join(', ')}
            WHERE product_id = $${paramIndex}
            RETURNING *
        `;
        values.push(productId);

        console.log('Update query:', query);
        console.log('Update values:', values);
        
        const result = await db.query(query, values);
        
        console.log('Product updated:', result.rows[0]);
        
        res.json({
            success: true,
            message: 'Product updated successfully',
            product: result.rows[0]
        });

    } catch (error) {
        console.error('Update product error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error',
            details: error.message 
        });
    }
};

// Delete product (farmer only)
const deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Validate id is a number
        const productId = parseInt(id);
        if (isNaN(productId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid product ID format' 
            });
        }
        
        const farmerResult = await Farmer.findByUserId(req.user.user_id);
        
        if (farmerResult.rows.length === 0) {
            return res.status(403).json({ 
                success: false, 
                error: 'User is not a registered farmer' 
            });
        }

        const farmer_id = farmerResult.rows[0].farmer_id;

        // Verify product belongs to this farmer and delete
        const query = 'DELETE FROM products WHERE product_id = $1 AND farmer_id = $2 RETURNING *';
        const result = await db.query(query, [productId, farmer_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Product not found or not authorized' 
            });
        }

        res.json({
            success: true,
            message: 'Product deleted successfully'
        });

    } catch (error) {
        console.error('Delete product error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error',
            details: error.message 
        });
    }
};

// Update product status (farmer only)
const updateProductStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        // Validate id is a number
        const productId = parseInt(id);
        if (isNaN(productId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid product ID format' 
            });
        }
        
        if (!['AVAILABLE', 'UNAVAILABLE'].includes(status)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid status. Must be AVAILABLE or UNAVAILABLE' 
            });
        }

        const farmerResult = await Farmer.findByUserId(req.user.user_id);
        
        if (farmerResult.rows.length === 0) {
            return res.status(403).json({ 
                success: false, 
                error: 'User is not a registered farmer' 
            });
        }

        const farmer_id = farmerResult.rows[0].farmer_id;

        const query = `
            UPDATE products 
            SET status = $1, updated_at = CURRENT_TIMESTAMP
            WHERE product_id = $2 AND farmer_id = $3
            RETURNING *
        `;
        
        const result = await db.query(query, [status, productId, farmer_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Product not found or not authorized' 
            });
        }

        res.json({
            success: true,
            message: 'Product status updated successfully',
            product: result.rows[0]
        });

    } catch (error) {
        console.error('Update product status error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error',
            details: error.message 
        });
    }
};

// Update product image only (farmer only)
const updateProductImage = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Validate id is a number
        const productId = parseInt(id);
        if (isNaN(productId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid product ID format' 
            });
        }
        
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                error: 'No image file provided' 
            });
        }

        const farmerResult = await Farmer.findByUserId(req.user.user_id);
        
        if (farmerResult.rows.length === 0) {
            return res.status(403).json({ 
                success: false, 
                error: 'User is not a registered farmer' 
            });
        }

        const farmer_id = farmerResult.rows[0].farmer_id;
        const image_url = `/uploads/${req.file.filename}`;

        const query = `
            UPDATE products 
            SET image_url = $1, updated_at = CURRENT_TIMESTAMP
            WHERE product_id = $2 AND farmer_id = $3
            RETURNING *
        `;
        
        const result = await db.query(query, [image_url, productId, farmer_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Product not found or not authorized' 
            });
        }

        res.json({
            success: true,
            message: 'Product image updated successfully',
            product: result.rows[0]
        });

    } catch (error) {
        console.error('Update product image error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error',
            details: error.message 
        });
    }
};

module.exports = {
    // New functions
    trackSearch,
    getTrendingSearches,
    getMostViewedProducts,
    getTopRatedProducts,
    getTrendingProducts,
    getSearchStats,
    // Existing functions
    getFarmerProducts,
    getAllProducts,
    searchProducts,
    getProductsByCategory,
    getProductsByFarmerId,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
    updateProductStatus,
    updateProductImage
};