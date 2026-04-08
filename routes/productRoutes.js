const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');
const pool = require('../config/database');
const FormData = require('form-data');
const fetch = require('node-fetch');

// Helper function to validate product image against category
const validateProductImage = async (imageBuffer, category, originalname) => {
    try {
        const formData = new FormData();
        formData.append('image', imageBuffer, originalname);
        
        const response = await fetch('http://localhost:5002/classify/predict', {
            method: 'POST',
            body: formData,
            headers: formData.getHeaders()
        });
        
        const result = await response.json();
        console.log('Python service response:', result);
        
        if (!result.success) {
            return {
                isValid: false,
                error: result.error || 'Python service error',
                prediction: null,
                confidence: 0
            };
        }
        
        const predictedCategory = result.prediction;
        const confidence = result.confidence;
        
        // RULE 1: Reject if model predicts "unknown" (non-food images)
        if (predictedCategory === 'unknown') {
            return {
                isValid: false,
                error: '❌ Invalid Product: This image does not appear to be a valid agricultural product. Please upload a photo of Rice, Fruits, Vegetables, or Crops.',
                prediction: predictedCategory,
                confidence: confidence
            };
        }
        
        // RULE 2: Reject if confidence is too low (below 50%)
        if (confidence < 50) {
            return {
                isValid: false,
                error: `⚠️ Low Quality Image: Our AI is only ${confidence}% confident about this image. Please upload a clearer photo with better lighting and a plain background.`,
                prediction: predictedCategory,
                confidence: confidence
            };
        }
        
        // RULE 3: Check if predicted category matches selected category
        const isValid = predictedCategory.toLowerCase() === category.toLowerCase();
        
        // RULE 4: If mismatch, provide helpful suggestion
        if (!isValid) {
            let suggestion = '';
            if (predictedCategory === 'fruits') suggestion = 'Did you mean to select "Fruits" as the category?';
            else if (predictedCategory === 'vegetables') suggestion = 'Did you mean to select "Vegetables" as the category?';
            else if (predictedCategory === 'crops') suggestion = 'Did you mean to select "Crops" as the category?';
            else if (predictedCategory === 'rice') suggestion = 'Did you mean to select "Rice" as the category?';
            else suggestion = 'Please verify your product category or upload a different image.';
            
            return {
                isValid: false,
                error: `❌ Category Mismatch: You selected "${category}", but our AI detected "${predictedCategory}" (${confidence}% confident). ${suggestion}`,
                prediction: predictedCategory,
                confidence: confidence,
                suggestedCategory: predictedCategory
            };
        }
        
        // SUCCESS: Image is valid
        return {
            isValid: true,
            prediction: predictedCategory,
            confidence: confidence,
            probabilities: result.probabilities,
            message: `✓ Verified: This is a valid ${category} product (${confidence}% confidence)`
        };
        
    } catch (error) {
        console.error('Image validation error:', error);
        return {
            isValid: false,
            error: error.message,
            prediction: null,
            confidence: 0
        };
    }
};

// ========== SEARCH TRACKING ENDPOINTS ==========

router.post('/track-search', authenticateToken, async (req, res) => {
    try {
        const { search_term, product_id } = req.body;
        const user_id = req.user.user_id || req.user.id;
        
        if (!search_term || search_term.trim().length < 2) {
            return res.status(400).json({ 
                success: false, 
                error: 'Search term is required and must be at least 2 characters' 
            });
        }
        
        const query = `
            INSERT INTO product_searches (search_term, product_id, user_id, searched_at)
            VALUES ($1, $2, $3, NOW())
            RETURNING search_id
        `;
        
        const result = await pool.query(query, [search_term.trim(), product_id || null, user_id]);
        
        if (product_id) {
            await pool.query(
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
});

router.get('/trending-searches', authenticateToken, async (req, res) => {
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
        const result = await pool.query(query, [limit]);
        res.json({ success: true, trending: result.rows });
    } catch (error) {
        console.error('Error getting trending searches:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/most-viewed', authenticateToken, async (req, res) => {
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
        const result = await pool.query(query, [limit]);
        res.json({ success: true, products: result.rows });
    } catch (error) {
        console.error('Error getting most viewed products:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/top-rated', authenticateToken, async (req, res) => {
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
        const result = await pool.query(query, [limit, minReviews]);
        res.json({ success: true, products: result.rows });
    } catch (error) {
        console.error('Error getting top rated products:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/trending', authenticateToken, async (req, res) => {
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
        const result = await pool.query(query, [limit]);
        res.json({ success: true, products: result.rows });
    } catch (error) {
        console.error('Error getting trending products:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== PRODUCT CRUD ROUTES ==========

// POST /api/products - Create product (farmer only) with image validation
router.post('/', 
    authenticateToken, 
    authorizeRole('FARMER'),
    upload.single('product_image'),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'Product image is required'
                });
            }

            const { category } = req.body;
            
            if (!category) {
                return res.status(400).json({
                    success: false,
                    message: 'Product category is required'
                });
            }

            const validation = await validateProductImage(
                req.file.buffer,
                category,
                req.file.originalname
            );

            console.log('Validation result:', validation);

            // If validation failed due to service error, allow with warning
            if (validation.error) {
                console.log('Validation service error, allowing product creation with warning');
                req.imageValidation = { isValid: true, warning: 'AI service unavailable' };
                return await productController.createProduct(req, res);
            }

            // Reject if validation failed
            if (!validation.isValid) {
                return res.status(400).json({
                    success: false,
                    message: validation.error,
                    validation: {
                        predicted: validation.prediction,
                        confidence: validation.confidence,
                        expected: category,
                        suggested: validation.suggestedCategory
                    }
                });
            }

            console.log(`✅ Image validated: ${validation.prediction} (${validation.confidence}%) matches category ${category}`);
            
            req.imageValidation = validation;
            
            await productController.createProduct(req, res);
        } catch (error) {
            console.error('Route error - create product:', error);
            res.status(500).json({ 
                success: false,
                message: 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// POST /api/validate-product - Validate product image only
router.post('/validate-product',
    authenticateToken,
    authorizeRole('FARMER'),
    upload.single('image'),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'Image file is required'
                });
            }

            const { expectedCategory } = req.body;
            
            if (!expectedCategory) {
                return res.status(400).json({
                    success: false,
                    message: 'Category is required'
                });
            }

            const validation = await validateProductImage(
                req.file.buffer,
                expectedCategory,
                req.file.originalname
            );

            console.log('Validate endpoint result:', validation);

            if (validation.error) {
                return res.status(503).json({
                    success: false,
                    error: 'AI service unavailable',
                    message: validation.error
                });
            }

            const isValid = validation.isValid;
            const predictedCategory = validation.prediction;
            const confidence = validation.confidence;

            res.json({
                success: true,
                isValid: isValid,
                predictedCategory: predictedCategory,
                confidence: confidence,
                expectedCategory: expectedCategory,
                probabilities: validation.probabilities
            });
            
        } catch (error) {
            console.error('Route error - validate image:', error);
            res.status(500).json({ 
                success: false,
                message: 'Internal server error',
                error: error.message
            });
        }
    }
);

// GET /api/products - Get all products (public)
router.get('/', async (req, res) => {
    try {
        await productController.getAllProducts(req, res);
    } catch (error) {
        console.error('Route error - get all products:', error);
        res.status(500).json({ 
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// ========== UPDATED SEARCH ENDPOINT WITH SYNONYM SUPPORT ==========
// GET /api/products/search - Search products with synonym support
router.get('/search', async (req, res) => {
    try {
        const { query: searchQuery, synonyms, category, minPrice, maxPrice } = req.query;
        
        if (!searchQuery) {
            return res.status(400).json({ 
                success: false, 
                error: 'Search query is required' 
            });
        }

        // Build search terms including synonyms from frontend
        let searchTerms = [searchQuery.toLowerCase()];
        
        // Parse synonyms if provided (from frontend)
        if (synonyms) {
            const extraTerms = synonyms.split(',');
            searchTerms.push(...extraTerms);
        }
        
        // Remove duplicates
        searchTerms = [...new Set(searchTerms)];
        
        // Build SQL query with multiple terms
        const conditions = searchTerms.map((term, i) => 
            `(p.product_name ILIKE $${i + 1} OR p.local_name ILIKE $${i + 1} OR p.description ILIKE $${i + 1})`
        ).join(' OR ');
        
        const params = searchTerms.map(term => `%${term}%`);
        let paramIndex = searchTerms.length + 1;
        
        let sql = `
            SELECT 
                p.*,
                f.farm_name,
                f.barangay,
                u.full_name as farmer_name,
                COALESCE((SELECT AVG(fb.rating) FROM feedback fb WHERE fb.product_id = p.product_id), 0) as avg_rating,
                COALESCE((SELECT COUNT(*) FROM feedback fb WHERE fb.product_id = p.product_id), 0) as review_count
            FROM products p
            JOIN farmers f ON p.farmer_id = f.farmer_id
            JOIN users u ON f.user_id = u.user_id
            WHERE p.status = 'AVAILABLE' 
            AND (${conditions})
        `;
        
        // Add category filter if provided
        if (category) {
            sql += ` AND p.category = $${paramIndex}`;
            params.push(category);
            paramIndex++;
        }
        
        // Add price filters if provided
        if (minPrice) {
            sql += ` AND p.price >= $${paramIndex}`;
            params.push(parseFloat(minPrice));
            paramIndex++;
        }
        
        if (maxPrice) {
            sql += ` AND p.price <= $${paramIndex}`;
            params.push(parseFloat(maxPrice));
            paramIndex++;
        }
        
        sql += ' ORDER BY p.view_count DESC, p.created_at DESC LIMIT 50';
        
        console.log('Search terms used:', searchTerms);
        
        const result = await pool.query(sql, params);
        
        // Transform the results
        const products = result.rows.map(product => ({
            ...product,
            average_rating: product.avg_rating
        }));
        
        console.log(`Search found ${products.length} products for "${searchQuery}"`);
        
        res.json({
            success: true,
            products: products,
            count: products.length,
            search_terms_used: searchTerms
        });

    } catch (error) {
        console.error('Search products error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
});

// GET /api/products/category/:category - Get products by category (public)
router.get('/category/:category', async (req, res) => {
    try {
        await productController.getProductsByCategory(req, res);
    } catch (error) {
        console.error('Route error - get products by category:', error);
        res.status(500).json({ 
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// GET /api/products/farmer/:farmerId(\\d+) - Get ALL products by farmer ID (public)
router.get('/farmer/:farmerId(\\d+)', async (req, res) => {
    try {
        await productController.getProductsByFarmerId(req, res);
    } catch (error) {
        console.error('Route error - get products by farmer ID:', error);
        res.status(500).json({ 
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// GET /api/products/farmer/products - Get farmer's OWN products only (farmer only)
router.get('/farmer/products', 
    authenticateToken, 
    authorizeRole('FARMER'),
    async (req, res) => {
        try {
            await productController.getFarmerProducts(req, res);
        } catch (error) {
            console.error('Route error - get farmer products:', error);
            res.status(500).json({ 
                success: false,
                message: 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// GET /api/products/:id - Get product by ID (public)
router.get('/:id(\\d+)', async (req, res) => {
    try {
        await pool.query(
            `UPDATE products SET view_count = COALESCE(view_count, 0) + 1 WHERE product_id = $1`,
            [req.params.id]
        );
        await productController.getProductById(req, res);
    } catch (error) {
        console.error('Route error - get product by ID:', error);
        res.status(500).json({ 
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// PUT /api/products/:id - Update product (farmer only)
router.put('/:id(\\d+)',
    authenticateToken, 
    authorizeRole('FARMER'),
    upload.single('product_image'),
    async (req, res) => {
        try {
            if (req.file) {
                const { category } = req.body;
                let productCategory = category;
                
                if (!productCategory) {
                    const existingProduct = await productController.getProductByIdInternal(req.params.id);
                    productCategory = existingProduct?.category;
                }
                
                if (productCategory) {
                    const validation = await validateProductImage(
                        req.file.buffer,
                        productCategory,
                        req.file.originalname
                    );

                    if (validation.error) {
                        console.log('Validation error, allowing update with warning');
                    } else if (!validation.isValid) {
                        return res.status(400).json({
                            success: false,
                            message: validation.error,
                            validation: {
                                predicted: validation.prediction,
                                confidence: validation.confidence,
                                expected: productCategory,
                                suggested: validation.suggestedCategory
                            }
                        });
                    }
                    req.imageValidation = validation;
                }
            }
            await productController.updateProduct(req, res);
        } catch (error) {
            console.error('Route error - update product:', error);
            res.status(500).json({ 
                success: false,
                message: 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// PATCH /api/products/:id/status - Update product status
router.patch('/:id(\\d+)/status',
    authenticateToken, 
    authorizeRole('FARMER'),
    async (req, res) => {
        try {
            await productController.updateProductStatus(req, res);
        } catch (error) {
            console.error('Route error - update product status:', error);
            res.status(500).json({ 
                success: false,
                message: 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// DELETE /api/products/:id - Delete product
router.delete('/:id(\\d+)',
    authenticateToken, 
    authorizeRole('FARMER'),
    async (req, res) => {
        try {
            await productController.deleteProduct(req, res);
        } catch (error) {
            console.error('Route error - delete product:', error);
            res.status(500).json({ 
                success: false,
                message: 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

module.exports = router;