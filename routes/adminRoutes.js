const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');

// =====================================================
// 🔐 HELPER FUNCTION - Check Maintenance Mode
// =====================================================
const isMaintenanceMode = async () => {
    try {
        const tableCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'system_settings'
            );
        `);
        
        if (!tableCheck.rows[0].exists) {
            return false;
        }
        
        const result = await pool.query('SELECT maintenance_mode FROM system_settings LIMIT 1');
        return result.rows[0]?.maintenance_mode === true;
    } catch (error) {
        console.error('Error checking maintenance mode:', error);
        return false;
    }
};

// =====================================================
// 🔐 CREATE FIRST ADMIN
// =====================================================
router.post('/create-first-admin', async (req, res) => {
    try {
        const { full_name, email, password, confirm_password } = req.body;

        if (!full_name || !email || !password || !confirm_password) {
            return res.status(400).json({ success: false, error: 'All fields are required' });
        }

        if (password !== confirm_password) {
            return res.status(400).json({ success: false, error: 'Passwords do not match' });
        }

        const adminCheck = await pool.query(
            'SELECT user_id FROM users WHERE role = $1 LIMIT 1',
            ['ADMIN']
        );

        if (adminCheck.rows.length > 0) {
            return res.status(403).json({
                success: false,
                error: 'Admin already exists. Please login instead.'
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await pool.query(
            `INSERT INTO users (full_name, email, password, role, status, created_at)
             VALUES ($1, $2, $3, 'ADMIN', 'ACTIVE', NOW())
             RETURNING user_id, full_name, email, role, status`,
            [full_name, email, hashedPassword]
        );

        const admin = result.rows[0];

        const token = jwt.sign(
            {
                id: admin.user_id,
                role: admin.role
            },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '7d' }
        );

        res.status(201).json({
            success: true,
            token,
            user: admin
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================================================
// 🔐 ADMIN LOGIN (with maintenance mode check)
// =====================================================
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const maintenanceMode = await isMaintenanceMode();

        const result = await pool.query(
            `SELECT user_id, full_name, email, password, role, status
             FROM users WHERE email = $1 AND role = 'ADMIN'`,
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        const admin = result.rows[0];

        if (admin.status !== 'ACTIVE') {
            return res.status(403).json({ success: false, error: 'Account inactive' });
        }

        const valid = await bcrypt.compare(password, admin.password);
        if (!valid) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        if (maintenanceMode) {
            console.log(`⚠️ Maintenance mode ON - Admin ${admin.email} logged in`);
        }

        const token = jwt.sign(
            {
                id: admin.user_id,
                role: admin.role
            },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '7d' }
        );

        delete admin.password;

        res.json({
            success: true,
            token,
            user: admin,
            maintenance_mode: maintenanceMode
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================================================
// 🏠 MAINTENANCE STATUS (PUBLIC)
// =====================================================
router.get('/maintenance-status', async (req, res) => {
    try {
        console.log('🔧 Maintenance status check...');
        const maintenanceMode = await isMaintenanceMode();
        console.log(`🔧 Maintenance mode is: ${maintenanceMode ? 'ON' : 'OFF'}`);
        res.json({ maintenance_mode: maintenanceMode });
    } catch (error) {
        console.error('❌ Maintenance status error:', error);
        res.json({ maintenance_mode: false });
    }
});

// =====================================================
// 📊 DASHBOARD STATS
// =====================================================

router.get('/analytics', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        console.log('📊 Fetching analytics summary...');
        
        const usersQuery = await pool.query('SELECT COUNT(*) FROM users');
        const totalUsers = parseInt(usersQuery.rows[0].count) || 0;
        
        const farmersQuery = await pool.query('SELECT COUNT(*) FROM farmers');
        const totalFarmers = parseInt(farmersQuery.rows[0].count) || 0;
        
        const customersQuery = await pool.query(
            'SELECT COUNT(*) FROM users WHERE role = $1',
            ['CUSTOMER']
        );
        const totalCustomers = parseInt(customersQuery.rows[0].count) || 0;
        
        const productsQuery = await pool.query('SELECT COUNT(*) FROM products');
        const totalProducts = parseInt(productsQuery.rows[0].count) || 0;
        
        const availableProductsQuery = await pool.query(
            'SELECT COUNT(*) FROM products WHERE status = $1',
            ['AVAILABLE']
        );
        const availableProducts = parseInt(availableProductsQuery.rows[0].count) || 0;
        
        const pendingProductsQuery = await pool.query(
            'SELECT COUNT(*) FROM products WHERE status = $1',
            ['PENDING']
        );
        const pendingProducts = parseInt(pendingProductsQuery.rows[0].count) || 0;
        
        const ordersQuery = await pool.query('SELECT COUNT(*) FROM orders');
        const totalOrders = parseInt(ordersQuery.rows[0].count) || 0;
        
        const pendingOrdersQuery = await pool.query(
            'SELECT COUNT(*) FROM orders WHERE order_status = $1',
            ['PENDING']
        );
        const pendingOrders = parseInt(pendingOrdersQuery.rows[0].count) || 0;
        
        const completedOrdersQuery = await pool.query(
            'SELECT COUNT(*) FROM orders WHERE order_status = $1',
            ['DELIVERED']
        );
        const completedOrders = parseInt(completedOrdersQuery.rows[0].count) || 0;
        
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

router.get('/analytics/user-growth', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        console.log(`📈 Fetching user growth for last ${days} days...`);
        
        const labels = [];
        const values = [];
        
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
        
        const dataMap = {};
        result.rows.forEach(row => {
            const dateStr = new Date(row.date).toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric' 
            });
            dataMap[dateStr] = parseInt(row.count);
        });
        
        const today = new Date();
        for (let i = 0; i < days; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - (days - 1 - i));
            
            let label;
            if (days <= 7) {
                label = date.toLocaleDateString('en-US', { 
                    weekday: 'short', 
                    month: 'short', 
                    day: 'numeric' 
                });
            } else {
                label = date.toLocaleDateString('en-US', { 
                    month: 'short', 
                    day: 'numeric' 
                });
            }
            
            labels.push(label);
            
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

router.get('/analytics/sales', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        console.log(`💰 Fetching sales data for last ${days} days...`);
        
        const labels = [];
        const values = [];
        
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
        
        const dataMap = {};
        result.rows.forEach(row => {
            const dateStr = new Date(row.date).toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric' 
            });
            dataMap[dateStr] = parseFloat(row.total);
        });
        
        const today = new Date();
        for (let i = 0; i < days; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - (days - 1 - i));
            
            let label;
            if (days <= 7) {
                label = date.toLocaleDateString('en-US', { 
                    weekday: 'short', 
                    month: 'short', 
                    day: 'numeric' 
                });
            } else {
                label = date.toLocaleDateString('en-US', { 
                    month: 'short', 
                    day: 'numeric' 
                });
            }
            
            labels.push(label);
            
            const shortDate = date.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric' 
            });
            values.push(dataMap[shortDate] || 0);
        }
        
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

// =====================================================
// 👥 USER MANAGEMENT
// =====================================================

router.get('/users', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        
        const query = `
            SELECT 
                user_id,
                email,
                full_name,
                contact_number,
                barangay,
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

router.get('/users/:id', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const { id } = req.params;
        
        const query = `
            SELECT 
                user_id,
                email,
                full_name,
                contact_number,
                barangay,
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

// =====================================================
// 🚜 FARMER MANAGEMENT
// =====================================================

router.get('/farmers', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const query = `
            SELECT 
                f.farmer_id,
                f.farm_name,
                f.farm_description,
                f.verified_status,
                f.created_at,
                u.user_id,
                u.full_name,
                u.email,
                u.contact_number,
                u.barangay,
                u.status as user_status
            FROM farmers f
            JOIN users u ON f.user_id = u.user_id
            ORDER BY f.created_at DESC
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

router.get('/farmers/pending-verifications', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                f.farmer_id, 
                f.farm_name, 
                f.farm_description, 
                f.verified_status,
                f.created_at,
                u.full_name, 
                u.email,
                u.contact_number,
                u.barangay
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

router.patch('/farmers/:id/verify', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    const farmerId = req.params.id;
    const { verified_status } = req.body;

    const client = await pool.connect();

    try {
        console.log(`🔍 Verifying farmer ID: ${farmerId}, Status: ${verified_status}`);

        await client.query('BEGIN');

        const farmerResult = await client.query(`
            SELECT f.farmer_id, f.user_id, f.verified_status, u.email, u.full_name, u.contact_number, u.barangay
            FROM farmers f
            JOIN users u ON f.user_id = u.user_id
            WHERE f.farmer_id = $1
        `, [farmerId]);

        if (farmerResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Farmer not found' });
        }

        const farmer = farmerResult.rows[0];

        if (verified_status === false || verified_status === 'false') {
            await client.query(`DELETE FROM farmers WHERE farmer_id = $1`, [farmerId]);
            console.log(`❌ Farmer application ${farmerId} rejected and removed`);
        } else {
            const result = await client.query(`
                UPDATE farmers
                SET verified_status = $1, updated_at = NOW()
                WHERE farmer_id = $2
                RETURNING *
            `, [verified_status, farmerId]);

            if (verified_status === true || verified_status === 'true') {
                await client.query(`
                    UPDATE users
                    SET role = 'FARMER', updated_at = NOW()
                    WHERE user_id = $1
                `, [farmer.user_id]);
                console.log(`✅ User ${farmer.user_id} role updated to FARMER`);
            }
        }

        await client.query('COMMIT');

        const message = (verified_status === true || verified_status === 'true')
            ? `Farmer ${farmer.full_name} has been verified and can now sell products`
            : `Farmer ${farmer.full_name} application has been rejected`;

        console.log(`✅ Farmer ${farmerId} verification status updated to: ${verified_status}`);

        res.json({
            success: true,
            farmer: { farmer_id: farmerId },
            message
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error verifying farmer:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

// =====================================================
// 📦 PRODUCT MANAGEMENT
// =====================================================

router.get('/products', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const query = `
            SELECT 
                p.product_id,
                p.product_name,
                p.category,
                p.price,
                p.status,
                p.stock,
                p.created_at,
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

// =====================================================
// 📋 ORDER MANAGEMENT
// =====================================================

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

// =====================================================
// ⚙️ SETTINGS MANAGEMENT
// =====================================================

router.get('/settings', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const checkTable = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'system_settings'
            );
        `);
        
        if (!checkTable.rows[0].exists) {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS system_settings (
                    id SERIAL PRIMARY KEY,
                    platform_name VARCHAR(255) DEFAULT 'Digital Farmers Market',
                    support_email VARCHAR(255) DEFAULT 'support@digitalfarmers.com',
                    support_phone VARCHAR(50) DEFAULT '09123456789',
                    cod_enabled BOOLEAN DEFAULT true,
                    maintenance_mode BOOLEAN DEFAULT false,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_by INT
                )
            `);
            
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
        
        const result = await pool.query('SELECT * FROM system_settings LIMIT 1');
        
        if (result.rows.length === 0) {
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
        
        res.json({
            success: true,
            settings: result.rows[0]
        });
        
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            settings: {
                platform_name: 'Digital Farmers Market',
                support_email: 'support@digitalfarmers.com',
                support_phone: '09123456789',
                cod_enabled: true,
                maintenance_mode: false
            }
        });
    }
});

router.put('/settings', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const { settings } = req.body;
        
        console.log('⚙️ Updating settings:', settings);
        
        const checkTable = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'system_settings'
            );
        `);
        
        if (!checkTable.rows[0].exists) {
            await pool.query(`
                CREATE TABLE system_settings (
                    id SERIAL PRIMARY KEY,
                    platform_name VARCHAR(255) DEFAULT 'Digital Farmers Market',
                    support_email VARCHAR(255) DEFAULT 'support@digitalfarmers.com',
                    support_phone VARCHAR(50) DEFAULT '09123456789',
                    cod_enabled BOOLEAN DEFAULT true,
                    maintenance_mode BOOLEAN DEFAULT false,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_by INT
                )
            `);
        }
        
        const checkSettings = await pool.query('SELECT COUNT(*) FROM system_settings');
        
        let result;
        if (parseInt(checkSettings.rows[0].count) > 0) {
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
                settings.cod_enabled !== undefined ? settings.cod_enabled : true,
                settings.maintenance_mode === true || settings.maintenance_mode === 'true',
                req.user.id
            ]);
        } else {
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
                settings.cod_enabled !== undefined ? settings.cod_enabled : true,
                settings.maintenance_mode === true || settings.maintenance_mode === 'true',
                req.user.id
            ]);
        }
        
        console.log(`✅ Settings updated. Maintenance mode: ${settings.maintenance_mode}`);
        
        res.json({
            success: true,
            message: 'Settings updated successfully',
            settings: result.rows[0]
        });
        
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// =====================================================
// 📜 ADMIN LOGS
// =====================================================

router.get('/settings/logs', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
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