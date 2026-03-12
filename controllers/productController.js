// controllers/productController.js
const db = require('../config/database');
const Farmer = require('../models/farmerModel');

console.log('✅ Product controller loaded');

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

// Get all products (public)
const getAllProducts = async (req, res) => {
    try {
        const { category, minPrice, maxPrice, sort, page = 1, limit = 12 } = req.query;
        
        let query = `
            SELECT p.*, f.farm_name, f.barangay,
                   CASE WHEN p.stock > 0 THEN true ELSE false END as in_stock
            FROM products p
            JOIN farmers f ON p.farmer_id = f.farmer_id
            WHERE p.status = 'AVAILABLE'
        `;
        const values = [];
        let paramIndex = 1;

        if (category) {
            query += ` AND p.category = $${paramIndex++}`;
            values.push(category);
        }

        if (minPrice) {
            query += ` AND p.price >= $${paramIndex++}`;
            values.push(minPrice);
        }

        if (maxPrice) {
            query += ` AND p.price <= $${paramIndex++}`;
            values.push(maxPrice);
        }

        // Add sorting
        switch (sort) {
            case 'price_low':
                query += ' ORDER BY p.price ASC';
                break;
            case 'price_high':
                query += ' ORDER BY p.price DESC';
                break;
            case 'popular':
                query += ' ORDER BY p.sold_count DESC NULLS LAST';
                break;
            default:
                query += ' ORDER BY p.created_at DESC';
        }

        // Add pagination
        const offset = (page - 1) * limit;
        query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        values.push(limit, offset);

        const result = await db.query(query, values);
        
        // Get total count for pagination
        const countQuery = 'SELECT COUNT(*) FROM products WHERE status = $1';
        const countResult = await db.query(countQuery, ['AVAILABLE']);
        const total = parseInt(countResult.rows[0].count);

        res.json({
            success: true,
            products: result.rows,
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

// Search products (public)
const searchProducts = async (req, res) => {
    try {
        const { query: searchQuery } = req.query;
        
        if (!searchQuery) {
            return res.status(400).json({ 
                success: false, 
                error: 'Search query is required' 
            });
        }

        const sql = `
            SELECT p.*, f.farm_name, f.barangay,
                   CASE WHEN p.stock > 0 THEN true ELSE false END as in_stock
            FROM products p
            JOIN farmers f ON p.farmer_id = f.farmer_id
            WHERE p.status = 'AVAILABLE' 
            AND (p.product_name ILIKE $1 OR p.description ILIKE $1 OR f.farm_name ILIKE $1)
            ORDER BY p.created_at DESC
        `;

        const result = await db.query(sql, [`%${searchQuery}%`]);
        
        res.json({
            success: true,
            products: result.rows,
            count: result.rows.length
        });

    } catch (error) {
        console.error('Search products error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
};

// Get products by category (public)
const getProductsByCategory = async (req, res) => {
    try {
        const { category } = req.params;
        
        const query = `
            SELECT p.*, f.farm_name, f.barangay,
                   CASE WHEN p.stock > 0 THEN true ELSE false END as in_stock
            FROM products p
            JOIN farmers f ON p.farmer_id = f.farmer_id
            WHERE p.category = $1 AND p.status = 'AVAILABLE'
            ORDER BY p.created_at DESC
        `;

        const result = await db.query(query, [category]);
        
        res.json({
            success: true,
            products: result.rows,
            count: result.rows.length
        });

    } catch (error) {
        console.error('Get products by category error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
};

// Get product by ID (public)
const getProductById = async (req, res) => {
    try {
        const { id } = req.params;
        
        const query = `
            SELECT p.*, f.farm_name, f.barangay, f.farmer_id,
                   CASE WHEN p.stock > 0 THEN true ELSE false END as in_stock
            FROM products p
            JOIN farmers f ON p.farmer_id = f.farmer_id
            WHERE p.product_id = $1
        `;

        const result = await db.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Product not found' 
            });
        }

        res.json({
            success: true,
            product: result.rows[0]
        });

    } catch (error) {
        console.error('Get product by ID error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
};

// Create new product (farmer only) - UPDATED WITH STOCK
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
        
        console.log('Received data:', { product_name, category, price, unit, stock, harvest_date, description });
        
        // Validate required fields - ADDED STOCK
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

        const values = [farmer_id, product_name, category, price, unit, stock, harvest_date || null, description || null, image_url];
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

// Update product (farmer only) - FIXED WITH STOCK
const updateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log('Updating product ID:', id);
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
        const checkResult = await db.query(checkQuery, [id, farmer_id]);
        
        if (checkResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Product not found or not authorized' 
            });
        }

        // Get values from request body
        const product_name = req.body.product_name;
        const category = req.body.category;
        const price = req.body.price;
        const unit = req.body.unit;
        const stock = req.body.stock; // ADDED STOCK
        const harvest_date = req.body.harvest_date;
        const description = req.body.description;
        const status = req.body.status;
        
        console.log('Extracted values:', {
            product_name,
            category,
            price,
            unit,
            stock, // ADDED STOCK
            harvest_date,
            description,
            status
        });
        
        // Build dynamic update query based on your schema
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
        // FIXED: Added stock update block
        if (stock !== undefined) {
            console.log('Adding stock to update:', stock);
            // Validate stock is not negative
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

        // Update the updated_at timestamp
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
        values.push(id);

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
        const result = await db.query(query, [id, farmer_id]);
        
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
        
        const result = await db.query(query, [status, id, farmer_id]);
        
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
        
        const result = await db.query(query, [image_url, id, farmer_id]);
        
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
    getFarmerProducts,
    getAllProducts,
    searchProducts,
    getProductsByCategory,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
    updateProductStatus,
    updateProductImage
};