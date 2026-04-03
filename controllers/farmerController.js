const Farmer = require('../models/farmerModel');
const Product = require('../models/productModel');
const Order = require('../models/orderModel');
const db = require('../config/database');

console.log('✅ Farmer controller loaded');

// ===== PUBLIC FUNCTIONS (no authentication needed) =====

/**
 * Get farmer profile by ID (public)
 */
const getFarmerProfile = async (req, res) => {
    try {
        const { farmerId } = req.params;
        
        console.log('📋 Fetching farmer profile for ID:', farmerId);
        
        if (!farmerId) {
            return res.status(400).json({
                success: false,
                message: 'Farmer ID is required'
            });
        }

        const farmerQuery = `
            SELECT 
                f.farmer_id,
                f.farm_name,
                f.barangay,
                f.farm_description,
                f.verified_status,
                f.created_at,
                f.updated_at,
                u.user_id,
                u.full_name,
                u.email,
                u.contact_number,
                u.address,
                u.barangay as user_barangay,
                u.created_at as user_created_at
            FROM farmers f
            JOIN users u ON f.user_id = u.user_id
            WHERE f.farmer_id = $1 AND u.status = 'ACTIVE'
        `;
        
        const farmerResult = await db.query(farmerQuery, [farmerId]);
        
        if (farmerResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Farmer not found'
            });
        }
        
        const farmer = farmerResult.rows[0];
        
        // Ensure verified_status is sent as a proper boolean
        farmer.verified_status = farmer.verified_status === true || 
                                 farmer.verified_status === 'true' || 
                                 farmer.verified_status === 1 || 
                                 farmer.verified_status === '1' || 
                                 farmer.verified_status === 't' ? true : false;
        
        // Get product statistics
        const statsQuery = `
            SELECT 
                COUNT(*) as total_products,
                COUNT(CASE WHEN status = 'AVAILABLE' AND stock > 0 THEN 1 END) as available_products,
                COALESCE(SUM(stock), 0) as total_stock,
                COALESCE(AVG(average_rating), 0) as avg_rating,
                COALESCE(SUM(sold_count), 0) as total_sold
            FROM products 
            WHERE farmer_id = $1
        `;
        
        const statsResult = await db.query(statsQuery, [farmerId]);
        
        // Get recent products
        const productsQuery = `
            SELECT 
                product_id,
                product_name,
                category,
                price,
                unit,
                stock,
                image_url,
                average_rating,
                total_reviews,
                status,
                created_at
            FROM products
            WHERE farmer_id = $1 AND status = 'AVAILABLE'
            ORDER BY created_at DESC
            LIMIT 5
        `;
        
        const productsResult = await db.query(productsQuery, [farmerId]);
        
        res.json({
            success: true,
            farmer: {
                ...farmer,
                stats: statsResult.rows[0] || {
                    total_products: 0,
                    available_products: 0,
                    total_stock: 0,
                    avg_rating: 0,
                    total_sold: 0
                },
                recent_products: productsResult.rows
            }
        });
        
    } catch (error) {
        console.error('❌ Error in getFarmerProfile:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch farmer profile',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ===== PROTECTED FUNCTIONS (require authentication) =====

/**
 * Get farmer dashboard data (protected)
 */
const getFarmerDashboard = async (req, res) => {
    try {
        console.log('📊 Getting dashboard for farmer, user ID:', req.user.id);
        
        // Get farmer_id from the authenticated user
        const farmerResult = await Farmer.findByUserId(req.user.id);
        
        if (farmerResult.rows.length === 0) {
            return res.status(403).json({ 
                success: false,
                error: 'User is not a registered farmer' 
            });
        }

        const farmer = farmerResult.rows[0];
        const farmer_id = farmer.farmer_id;

        // Log the raw value from database
        console.log('Raw verified_status from DB in dashboard:', farmer.verified_status, 'Type:', typeof farmer.verified_status);
        
        // Convert to boolean explicitly
        const verified_status = farmer.verified_status === true || 
                                farmer.verified_status === 'true' || 
                                farmer.verified_status === 1 || 
                                farmer.verified_status === '1' || 
                                farmer.verified_status === 't' ? true : false;
        
        console.log('Sending verified_status in dashboard as:', verified_status, 'Type:', typeof verified_status);

        // Get farmer statistics - FIXED: Using correct column names
        const statsQuery = `
            SELECT 
                COUNT(DISTINCT p.product_id) as total_products,
                COUNT(DISTINCT CASE WHEN p.status = 'AVAILABLE' AND p.stock > 0 THEN p.product_id END) as active_products,
                COALESCE(SUM(p.stock), 0) as total_stock,
                COALESCE(SUM(p.sold_count), 0) as total_sold,
                COALESCE(COUNT(DISTINCT o.order_id), 0) as total_orders,
                COALESCE(SUM(oi.quantity * oi.price), 0) as total_revenue
            FROM farmers f
            LEFT JOIN products p ON f.farmer_id = p.farmer_id
            LEFT JOIN order_items oi ON p.product_id = oi.product_id
            LEFT JOIN orders o ON oi.order_id = o.order_id AND o.order_status != 'cancelled'
            WHERE f.farmer_id = $1
            GROUP BY f.farmer_id
        `;
        
        const statsResult = await db.query(statsQuery, [farmer_id]);
        
        // Get recent orders - FIXED: Using customer_id instead of user_id
        const ordersQuery = `
            SELECT 
                o.order_id,
                o.order_date,
                o.order_status as status,
                o.total_amount,
                u.full_name as customer_name,
                COUNT(oi.order_item_id) as items_count
            FROM orders o
            JOIN order_items oi ON o.order_id = oi.order_id
            JOIN products p ON oi.product_id = p.product_id
            JOIN users u ON o.customer_id = u.user_id
            WHERE p.farmer_id = $1
            GROUP BY o.order_id, u.full_name
            ORDER BY o.order_date DESC
            LIMIT 5
        `;
        
        const ordersResult = await db.query(ordersQuery, [farmer_id]);
        
        // Get low stock products
        const lowStockQuery = `
            SELECT 
                product_id,
                product_name,
                stock,
                low_stock_threshold,
                price,
                unit
            FROM products
            WHERE farmer_id = $1 
                AND status = 'AVAILABLE' 
                AND stock <= COALESCE(low_stock_threshold, 5)
            ORDER BY stock ASC
            LIMIT 5
        `;
        
        const lowStockResult = await db.query(lowStockQuery, [farmer_id]);
        
        // Get unavailable products
        const unavailableQuery = `
            SELECT 
                product_id,
                product_name,
                stock,
                updated_at
            FROM products 
            WHERE farmer_id = $1 
            AND status = 'UNAVAILABLE'
            ORDER BY updated_at DESC
            LIMIT 5
        `;
        
        const unavailableResult = await db.query(unavailableQuery, [farmer_id]);
        
        res.json({
            success: true,
            farmer: {
                farmer_id: farmer.farmer_id,
                farm_name: farmer.farm_name,
                barangay: farmer.barangay,
                farm_description: farmer.farm_description, 
                verified_status: verified_status
            },
            statistics: statsResult.rows[0] || {
                total_products: 0,
                active_products: 0,
                total_stock: 0,
                total_sold: 0,
                total_orders: 0,
                total_revenue: 0
            },
            recent_orders: ordersResult.rows,
            low_stock_products: lowStockResult.rows,
            unavailable_products: unavailableResult.rows
        });
        
    } catch (error) {
        console.error('❌ Get farmer dashboard error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Server error',
            message: error.message
        });
    }
};

/**
 * Update farmer profile (protected)
 */
const updateFarmerProfile = async (req, res) => {
    try {
        console.log('📝 Updating farmer profile for user:', req.user.id);
        
        const { farm_name, barangay, farm_description } = req.body;
        
        const farmerResult = await Farmer.findByUserId(req.user.id);
        
        if (farmerResult.rows.length === 0) {
            return res.status(403).json({ 
                success: false,
                error: 'User is not a registered farmer' 
            });
        }

        const farmer_id = farmerResult.rows[0].farmer_id;
        const updateData = {};

        if (farm_name) updateData.farm_name = farm_name;
        if (barangay) updateData.barangay = barangay;
        if (farm_description) updateData.farm_description = farm_description; 

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ 
                success: false,
                error: 'No data provided for update' 
            });
        }

        const result = await Farmer.updateFarmerProfile(farmer_id, updateData);
        
        console.log('✅ Farmer profile updated for:', farmer_id);
        
        res.json({
            success: true,
            message: 'Farmer profile updated successfully',
            farmer: result.rows[0]
        });
        
    } catch (error) {
        console.error('❌ Update farmer profile error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Server error' 
        });
    }
};

/**
 * Get farmer sales report (protected)
 */
const getFarmerSalesReport = async (req, res) => {
    try {
        const farmerResult = await Farmer.findByUserId(req.user.id);
        
        if (farmerResult.rows.length === 0) {
            return res.status(403).json({ 
                success: false,
                error: 'User is not a registered farmer' 
            });
        }

        const farmer_id = farmerResult.rows[0].farmer_id;
        const { period = 'monthly' } = req.query;

        let dateRange;
        let interval;
        
        switch (period) {
            case 'weekly':
                dateRange = "CURRENT_DATE - INTERVAL '7 days'";
                interval = 'day';
                break;
            case 'monthly':
                dateRange = "CURRENT_DATE - INTERVAL '30 days'";
                interval = 'day';
                break;
            case 'yearly':
                dateRange = "CURRENT_DATE - INTERVAL '365 days'";
                interval = 'month';
                break;
            default:
                dateRange = "CURRENT_DATE - INTERVAL '30 days'";
                interval = 'day';
        }

        const salesQuery = `
            SELECT 
                DATE_TRUNC($1, o.order_date) as period_date,
                TO_CHAR(DATE_TRUNC($1, o.order_date), 'YYYY-MM-DD') as period,
                COUNT(DISTINCT o.order_id) as total_orders,
                COALESCE(SUM(oi.quantity * oi.price), 0) as total_sales,
                SUM(oi.quantity) as total_items_sold
            FROM orders o
            JOIN order_items oi ON o.order_id = oi.order_id
            JOIN products p ON oi.product_id = p.product_id
            WHERE p.farmer_id = $2
            AND o.order_date >= ${dateRange}
            AND o.order_status = 'delivered'
            GROUP BY DATE_TRUNC($1, o.order_date)
            ORDER BY period_date DESC
        `;

        const productSalesQuery = `
            SELECT 
                p.product_id,
                p.product_name,
                p.category,
                p.price,
                p.unit,
                SUM(oi.quantity) as quantity_sold,
                SUM(oi.quantity * oi.price) as revenue
            FROM products p
            JOIN order_items oi ON p.product_id = oi.product_id
            JOIN orders o ON oi.order_id = o.order_id
            WHERE p.farmer_id = $1
            AND o.order_date >= ${dateRange}
            AND o.order_status = 'delivered'
            GROUP BY p.product_id, p.product_name, p.category, p.price, p.unit
            ORDER BY revenue DESC
            LIMIT 10
        `;

        const [salesResult, productSalesResult] = await Promise.all([
            db.query(salesQuery, [interval, farmer_id]),
            db.query(productSalesQuery, [farmer_id])
        ]);

        const summary = {
            total_sales: salesResult.rows.reduce((sum, row) => sum + parseFloat(row.total_sales || 0), 0),
            total_orders: salesResult.rows.reduce((sum, row) => sum + parseInt(row.total_orders || 0), 0),
            total_items_sold: salesResult.rows.reduce((sum, row) => sum + parseInt(row.total_items_sold || 0), 0),
            average_order_value: 0
        };
        
        if (summary.total_orders > 0) {
            summary.average_order_value = summary.total_sales / summary.total_orders;
        }

        console.log(`✅ Sales report generated for farmer ${farmer_id}, period: ${period}`);
        
        res.json({
            success: true,
            period,
            sales_data: salesResult.rows,
            top_products: productSalesResult.rows,
            summary
        });
        
    } catch (error) {
        console.error('❌ Get farmer sales report error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Server error' 
        });
    }
};

/**
 * Get farmer inventory (protected)
 */
const getFarmerInventory = async (req, res) => {
    try {
        const farmerResult = await Farmer.findByUserId(req.user.id);
        
        if (farmerResult.rows.length === 0) {
            return res.status(403).json({ 
                success: false,
                error: 'User is not a registered farmer' 
            });
        }

        const farmer_id = farmerResult.rows[0].farmer_id;
        const { category, status, sortBy = 'created_at', sortOrder = 'DESC' } = req.query;

        let query = `
            SELECT 
                p.*,
                COUNT(DISTINCT oi.order_item_id) as times_sold
            FROM products p
            LEFT JOIN order_items oi ON p.product_id = oi.product_id
            WHERE p.farmer_id = $1
        `;
        
        const values = [farmer_id];
        let paramIndex = 2;

        if (category && category !== '') {
            query += ` AND p.category = $${paramIndex}`;
            values.push(category);
            paramIndex++;
        }

        if (status && status !== '') {
            query += ` AND p.status = $${paramIndex}`;
            values.push(status);
            paramIndex++;
        }

        query += ` GROUP BY p.product_id ORDER BY p.${sortBy} ${sortOrder}`;
        
        const result = await db.query(query, values);
        
        let totalValue = 0;
        let totalStock = 0;
        let lowStockCount = 0;
        let outOfStockCount = 0;
        
        result.rows.forEach(product => {
            const stock = parseInt(product.stock || 0);
            const price = parseFloat(product.price || 0);
            
            totalStock += stock;
            totalValue += stock * price;
            
            if (stock === 0) {
                outOfStockCount++;
            } else if (stock <= 5) {
                lowStockCount++;
            }
        });
        
        const summary = {
            total_products: result.rows.length,
            total_available: result.rows.filter(p => p.status === 'AVAILABLE').length,
            total_unavailable: result.rows.filter(p => p.status === 'UNAVAILABLE').length,
            total_stock: totalStock,
            total_value: totalValue,
            low_stock_count: lowStockCount,
            out_of_stock_count: outOfStockCount
        };

        console.log(`✅ Inventory loaded for farmer ${farmer_id}: ${result.rows.length} products`);
        
        res.json({
            success: true,
            inventory: result.rows,
            summary
        });
        
    } catch (error) {
        console.error('❌ Get farmer inventory error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Server error' 
        });
    }
};

module.exports = {
    getFarmerProfile,
    getFarmerDashboard,
    updateFarmerProfile,
    getFarmerSalesReport,
    getFarmerInventory
};