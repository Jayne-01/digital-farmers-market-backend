const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');

// ========== DASHBOARD STATS ==========
// GET /api/admin/analytics - Main analytics summary
router.get('/analytics', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        console.log('📊 Fetching analytics summary...');
        
        // Get total users count
        const usersQuery = await pool.query('SELECT COUNT(*) FROM users');
        const totalUsers = parseInt(usersQuery.rows[0].count) || 0;
        
        // Get farmers count
        const farmersQuery = await pool.query('SELECT COUNT(*) FROM farmers');
        const totalFarmers = parseInt(farmersQuery.rows[0].count) || 0;
        
        // Get customers count (users who are not farmers)
        const customersQuery = await pool.query(
            'SELECT COUNT(*) FROM users WHERE role = $1',
            ['CUSTOMER']
        );
        const totalCustomers = parseInt(customersQuery.rows[0].count) || 0;
        
        // Get total products
        const productsQuery = await pool.query('SELECT COUNT(*) FROM products');
        const totalProducts = parseInt(productsQuery.rows[0].count) || 0;
        
        // Get available products
        const availableProductsQuery = await pool.query(
            'SELECT COUNT(*) FROM products WHERE status = $1',
            ['AVAILABLE']
        );
        const availableProducts = parseInt(availableProductsQuery.rows[0].count) || 0;
        
        // Get pending products
        const pendingProductsQuery = await pool.query(
            'SELECT COUNT(*) FROM products WHERE status = $1',
            ['PENDING']
        );
        const pendingProducts = parseInt(pendingProductsQuery.rows[0].count) || 0;
        
        // Get total orders
        const ordersQuery = await pool.query('SELECT COUNT(*) FROM orders');
        const totalOrders = parseInt(ordersQuery.rows[0].count) || 0;
        
        // Get pending orders
        const pendingOrdersQuery = await pool.query(
            'SELECT COUNT(*) FROM orders WHERE order_status = $1',
            ['PENDING']
        );
        const pendingOrders = parseInt(pendingOrdersQuery.rows[0].count) || 0;
        
        // Get completed orders (delivered)
        const completedOrdersQuery = await pool.query(
            'SELECT COUNT(*) FROM orders WHERE order_status = $1',
            ['DELIVERED']
        );
        const completedOrders = parseInt(completedOrdersQuery.rows[0].count) || 0;
        
        // Get total revenue (sum of all delivered orders)
        const revenueQuery = await pool.query(
            'SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE order_status = $1',
            ['DELIVERED']
        );
        const totalRevenue = parseFloat(revenueQuery.rows[0].total) || 0;
        
        const summary = {
            total_users: totalUsers,
            total_farmers: totalFarmers,
            total_customers: totalCustomers,
            total_products: totalProducts,
            available_products: availableProducts,
            pending_products: pendingProducts,
            total_orders: totalOrders,
            pending_orders: pendingOrders,
            completed_orders: completedOrders,
            total_revenue: totalRevenue
        };
        
        console.log('✅ Analytics summary:', summary);
        
        res.json({
            success: true,
            summary: summary
        });
        
    } catch (error) {
        console.error('❌ Error fetching analytics:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// GET /api/admin/analytics/user-growth - User growth over time
router.get('/analytics/user-growth', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        console.log(`📈 Fetching user growth for last ${days} days...`);
        
        // Generate date labels
        const labels = [];
        const values = [];
        
        // Get users created in the last N days, grouped by date
        const query = `
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as count
            FROM users
            WHERE created_at >= NOW() - INTERVAL '${days} days'
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `;
        
        const result = await pool.query(query);
        
        // Create a map of date -> count
        const dataMap = {};
        result.rows.forEach(row => {
            const dateStr = new Date(row.date).toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric' 
            });
            dataMap[dateStr] = parseInt(row.count);
        });
        
        // Generate labels for the last N days
        const today = new Date();
        for (let i = 0; i < days; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - (days - 1 - i));
            
            let label;
            if (days <= 7) {
                // For week view: "Mon, Feb 24"
                label = date.toLocaleDateString('en-US', { 
                    weekday: 'short', 
                    month: 'short', 
                    day: 'numeric' 
                });
            } else {
                // For month view: "Feb 24"
                label = date.toLocaleDateString('en-US', { 
                    month: 'short', 
                    day: 'numeric' 
                });
            }
            
            labels.push(label);
            
            // Get count from map or default to 0
            const shortDate = date.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric' 
            });
            values.push(dataMap[shortDate] || 0);
        }
        
        console.log(`✅ User growth data generated for ${days} days`);
        
        res.json({
            success: true,
            labels: labels,
            values: values
        });
        
    } catch (error) {
        console.error('❌ Error fetching user growth:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// GET /api/admin/analytics/sales - Sales overview over time
router.get('/analytics/sales', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        console.log(`💰 Fetching sales data for last ${days} days...`);
        
        // Generate date labels
        const labels = [];
        const values = [];
        
        // Get sales (delivered orders) in the last N days, grouped by date
        const query = `
            SELECT 
                DATE(order_date) as date,
                COALESCE(SUM(total_amount), 0) as total
            FROM orders
            WHERE order_status = 'DELIVERED'
                AND order_date >= NOW() - INTERVAL '${days} days'
            GROUP BY DATE(order_date)
            ORDER BY date ASC
        `;
        
        const result = await pool.query(query);
        console.log('📊 Sales query result:', result.rows);
        
        // Create a map of date -> total
        const dataMap = {};
        result.rows.forEach(row => {
            const dateStr = new Date(row.date).toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric' 
            });
            dataMap[dateStr] = parseFloat(row.total);
        });
        
        // Generate labels for the last N days
        const today = new Date();
        for (let i = 0; i < days; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - (days - 1 - i));
            
            let label;
            if (days <= 7) {
                // For week view: "Mon, Feb 24"
                label = date.toLocaleDateString('en-US', { 
                    weekday: 'short', 
                    month: 'short', 
                    day: 'numeric' 
                });
            } else {
                // For month view: "Feb 24"
                label = date.toLocaleDateString('en-US', { 
                    month: 'short', 
                    day: 'numeric' 
                });
            }
            
            labels.push(label);
            
            // Get total from map or default to 0
            const shortDate = date.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric' 
            });
            values.push(dataMap[shortDate] || 0);
        }
        
        console.log(`✅ Sales data generated for ${days} days`);
        console.log('📊 Sample values:', values.slice(0, 5));
        
        res.json({
            success: true,
            labels: labels,
            values: values
        });
        
    } catch (error) {
        console.error('❌ Error fetching sales data:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ========== USER MANAGEMENT ==========
// GET /api/admin/users - Get all users
router.get('/users', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        
        const query = `
            SELECT 
                user_id,
                email,
                full_name,
                role,
                status,
                created_at
            FROM users
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
        `;
        
        const result = await pool.query(query, [limit, offset]);
        
        res.json({
            success: true,
            users: result.rows
        });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/admin/users/:id - Get single user
router.get('/users/:id', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const { id } = req.params;
        
        const query = `
            SELECT 
                user_id,
                email,
                full_name,
                role,
                status,
                created_at
            FROM users
            WHERE user_id = $1
        `;
        
        const result = await pool.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        res.json({
            success: true,
            user: result.rows[0]
        });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT /api/admin/users/:id/status - Update user status
router.put('/users/:id/status', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        const query = 'UPDATE users SET status = $1 WHERE user_id = $2 RETURNING *';
        const result = await pool.query(query, [status, id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        res.json({
            success: true,
            user: result.rows[0]
        });
    } catch (error) {
        console.error('Error updating user status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== FARMER MANAGEMENT ==========
// GET /api/admin/farmers - Get all farmers
router.get('/farmers', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const query = `
            SELECT 
                f.farmer_id,
                f.farm_name,
                f.barangay,
                f.verified_status,
                u.user_id,
                u.full_name,
                u.email,
                u.status as user_status,
                u.created_at
            FROM farmers f
            JOIN users u ON f.user_id = u.user_id
            ORDER BY u.created_at DESC
        `;
        
        const result = await pool.query(query);
        
        res.json({
            success: true,
            farmers: result.rows
        });
    } catch (error) {
        console.error('Error fetching farmers:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =======================
// Get pending farmer verifications
// =======================
router.get('/farmers/pending-verifications', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT f.farmer_id, f.farm_name, f.barangay, f.farm_description, f.verified_status,
                   u.full_name, u.email
            FROM farmers f
            JOIN users u ON f.user_id = u.user_id
            WHERE f.verified_status = FALSE
            ORDER BY f.created_at DESC
        `);
        res.json({ pending_verifications: result.rows });
    } catch (error) {
        console.error('Error fetching pending verifications:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =======================
// Verify a farmer
// =======================
router.patch('/farmers/:id/verify', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    const farmerId = req.params.id;
    const { verified_status } = req.body;

    try {
        const result = await pool.query(`
            UPDATE farmers
            SET verified_status = $1, updated_at = NOW()
            WHERE farmer_id = $2
            RETURNING *
        `, [verified_status, farmerId]);

        if (!result.rows.length) {
            return res.status(404).json({ success: false, error: 'Farmer not found' });
        }

        res.json({ success: true, farmer: result.rows[0] });
    } catch (error) {
        console.error('Error verifying farmer:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== PRODUCT MANAGEMENT ==========
// GET /api/admin/products - Get all products
router.get('/products', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const query = `
            SELECT 
                p.product_id,
                p.product_name,
                p.category,
                p.price,
                p.status,
                f.farm_name,
                f.farmer_id,
                u.full_name as farmer_name
            FROM products p
            JOIN farmers f ON p.farmer_id = f.farmer_id
            JOIN users u ON f.user_id = u.user_id
            ORDER BY p.created_at DESC
        `;
        
        const result = await pool.query(query);
        
        res.json({
            success: true,
            products: result.rows
        });
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PATCH /api/admin/products/:id/status - Update product status
router.patch('/products/:id/status', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        const query = 'UPDATE products SET status = $1 WHERE product_id = $2 RETURNING *';
        const result = await pool.query(query, [status, id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }
        
        res.json({
            success: true,
            product: result.rows[0]
        });
    } catch (error) {
        console.error('Error updating product status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== ORDER MANAGEMENT ==========
// GET /api/admin/orders - Get all orders
router.get('/orders', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const query = `
            SELECT 
                o.order_id,
                o.total_amount,
                o.order_status,
                o.order_date,
                o.customer_name,
                o.address,
                o.contact_number,
                o.delivery_option,
                o.payment_method,
                f.farm_name,
                u.full_name as farmer_name
            FROM orders o
            JOIN farmers f ON o.farmer_id = f.farmer_id
            JOIN users u ON f.user_id = u.user_id
            ORDER BY o.order_date DESC
        `;
        
        const result = await pool.query(query);
        
        res.json({
            success: true,
            orders: result.rows
        });
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PATCH /api/admin/orders/:id - Update order status
router.patch('/orders/:id', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const { id } = req.params;
        const { order_status } = req.body;
        
        const query = 'UPDATE orders SET order_status = $1 WHERE order_id = $2 RETURNING *';
        const result = await pool.query(query, [order_status, id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Order not found' });
        }
        
        res.json({
            success: true,
            order: result.rows[0]
        });
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== SETTINGS MANAGEMENT ==========
// GET /api/admin/settings - Get system settings
router.get('/settings', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        // Check if settings table exists, if not return default settings
        const checkTable = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'system_settings'
            );
        `);
        
        if (!checkTable.rows[0].exists) {
            // Return default settings
            return res.json({
                success: true,
                settings: {
                    platform_name: 'Digital Farmers Market',
                    support_email: 'support@digitalfarmers.com',
                    support_phone: '09123456789',
                    cod_enabled: true,
                    maintenance_mode: false
                }
            });
        }
        
        const query = 'SELECT * FROM system_settings LIMIT 1';
        const result = await pool.query(query);
        
        if (result.rows.length === 0) {
            return res.json({
                success: true,
                settings: {}
            });
        }
        
        res.json({
            success: true,
            settings: result.rows[0]
        });
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT /api/admin/settings - Update system settings
router.put('/settings', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const { settings } = req.body;
        
        // Check if settings table exists
        const checkTable = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'system_settings'
            );
        `);
        
        if (!checkTable.rows[0].exists) {
            // Create settings table
            await pool.query(`
                CREATE TABLE system_settings (
                    id SERIAL PRIMARY KEY,
                    platform_name VARCHAR(255),
                    support_email VARCHAR(255),
                    support_phone VARCHAR(50),
                    cod_enabled BOOLEAN DEFAULT true,
                    maintenance_mode BOOLEAN DEFAULT false,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_by INT REFERENCES users(user_id)
                );
            `);
        }
        
        // Check if settings exist
        const checkSettings = await pool.query('SELECT COUNT(*) FROM system_settings');
        
        let result;
        if (parseInt(checkSettings.rows[0].count) > 0) {
            // Update existing settings
            const query = `
                UPDATE system_settings 
                SET platform_name = $1,
                    support_email = $2,
                    support_phone = $3,
                    cod_enabled = $4,
                    maintenance_mode = $5,
                    updated_at = CURRENT_TIMESTAMP,
                    updated_by = $6
                RETURNING *
            `;
            result = await pool.query(query, [
                settings.platform_name,
                settings.support_email,
                settings.support_phone,
                settings.cod_enabled,
                settings.maintenance_mode,
                req.user.id
            ]);
        } else {
            // Insert new settings
            const query = `
                INSERT INTO system_settings 
                (platform_name, support_email, support_phone, cod_enabled, maintenance_mode, updated_by)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *
            `;
            result = await pool.query(query, [
                settings.platform_name,
                settings.support_email,
                settings.support_phone,
                settings.cod_enabled,
                settings.maintenance_mode,
                req.user.id
            ]);
        }
        
        res.json({
            success: true,
            settings: result.rows[0]
        });
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== ADMIN LOGS ==========
// GET /api/admin/settings/logs - Get admin action logs
router.get('/settings/logs', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        // Check if logs table exists
        const checkTable = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'admin_logs'
            );
        `);
        
        if (!checkTable.rows[0].exists) {
            return res.json({
                success: true,
                logs: []
            });
        }
        
        const query = `
            SELECT 
                l.action_id,
                l.action_type,
                l.target_id,
                l.details,
                l.created_at,
                u.full_name as admin_name,
                u.email as admin_email
            FROM admin_logs l
            LEFT JOIN users u ON l.admin_id = u.user_id
            ORDER BY l.created_at DESC
            LIMIT 50
        `;
        
        const result = await pool.query(query);
        
        res.json({
            success: true,
            logs: result.rows
        });
    } catch (error) {
        console.error('Error fetching logs:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;