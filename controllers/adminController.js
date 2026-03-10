const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config();

const User = require('../models/userModel');
const Farmer = require('../models/farmerModel');
const Order = require('../models/orderModel');
const Product = require('../models/productModel');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'digital_market',
    password: process.env.DB_PASSWORD || 'password',
    port: process.env.DB_PORT || 5432,
});

/* =====================================================
   🔐 CREATE FIRST ADMIN (PUBLIC – INITIAL SETUP ONLY)
===================================================== */
const createFirstAdmin = async (req, res) => {
    try {
        const { full_name, email, password, confirm_password } = req.body;

        if (!full_name || !email || !password || !confirm_password) {
            return res.status(400).json({
                success: false,
                error: 'All fields are required'
            });
        }

        if (password !== confirm_password) {
            return res.status(400).json({
                success: false,
                error: 'Passwords do not match'
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 8 characters'
            });
        }

        // Check if admin already exists
        const adminCheck = await pool.query(
            'SELECT user_id FROM users WHERE role = $1 LIMIT 1',
            ['ADMIN']
        );

        if (adminCheck.rows.length > 0) {
            return res.status(403).json({
                success: false,
                error: 'Admin already exists'
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await pool.query(
            `INSERT INTO users (
                full_name,
                email,
                password,
                role,
                status,
                created_at
            ) VALUES ($1, $2, $3, 'ADMIN', 'ACTIVE', NOW())
            RETURNING user_id, full_name, email, role, status, created_at`,
            [full_name, email, hashedPassword]
        );

        const admin = result.rows[0];

        const token = jwt.sign(
            {
                user_id: admin.user_id,
                email: admin.email,
                role: admin.role
            },
            process.env.JWT_SECRET || 'your-secret-key-change-in-production',
            { expiresIn: '7d' }
        );

        res.status(201).json({
            success: true,
            message: 'First admin created successfully',
            admin,
            token
        });

    } catch (error) {
        console.error('Create first admin error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create first admin'
        });
    }
};

/* =====================================================
   👥 USER MANAGEMENT
===================================================== */
const getAllUsers = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT user_id, full_name, email, role, status, created_at
             FROM users
             ORDER BY created_at DESC`
        );
        res.json({ users: result.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
};

const getUserDetails = async (req, res) => {
    try {
        const result = await User.findById(req.params.id);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const updateUserStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const result = await User.update(req.params.id, { status });
        res.json({ user: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const updateUserRole = async (req, res) => {
    try {
        const { role } = req.body;
        const result = await User.update(req.params.id, { role });
        res.json({ user: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

/* =====================================================
   🌾 FARMER MANAGEMENT
===================================================== */
const verifyFarmer = async (req, res) => {
    try {
        const { verified_status } = req.body;
        const result = await pool.query(
            'UPDATE farmers SET verified_status = $1 WHERE farmer_id = $2 RETURNING *',
            [verified_status, req.params.id]
        );
        res.json({ farmer: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const getPendingVerifications = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT f.*, u.full_name, u.email, u.contact_number
             FROM farmers f
             JOIN users u ON f.user_id = u.user_id
             WHERE f.verified_status = false`
        );
        res.json({ pending_verifications: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

/* =====================================================
   📦 PRODUCT MANAGEMENT
===================================================== */
const getAllProducts = async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM products`);
        res.json({ products: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const updateProductStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const result = await Product.update(req.params.id, { status });
        res.json({ product: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

/* =====================================================
   🛒 ORDER MANAGEMENT
===================================================== */
const getAllOrders = async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM orders`);
        res.json({ orders: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const updateOrder = async (req, res) => {
    try {
        const result = await Order.update(req.params.id, req.body);
        res.json({ order: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

/* =====================================================
   📊 SYSTEM ANALYTICS (FIXED VERSION)
===================================================== */
const getSystemAnalytics = async (req, res) => {
    try {
        // User stats
        const userStats = await pool.query(
            `SELECT role, COUNT(*) as count
             FROM users
             GROUP BY role`
        );

        // Product stats
        const productStats = await pool.query(
            `SELECT status, COUNT(*) as count
             FROM products
             GROUP BY status`
        );

        // Order stats – get all statuses and totals
        const orderStats = await pool.query(
            `SELECT order_status, COUNT(*) as count, SUM(total_amount) as total
             FROM orders
             GROUP BY order_status`
        );

        // Calculate order breakdowns
        let pending_orders = 0;
        let completed_orders = 0;
        orderStats.rows.forEach(row => {
            if (row.order_status === 'DELIVERED') {
                completed_orders = parseInt(row.count);
            } else {
                pending_orders += parseInt(row.count);
            }
        });

        // Total revenue from delivered orders only
        const totalRevenue = await pool.query(
            `SELECT SUM(total_amount) as total
             FROM orders
             WHERE order_status = 'DELIVERED'`
        );

        const summary = {
            total_users: userStats.rows.reduce((sum, row) => sum + parseInt(row.count), 0),
            total_farmers: userStats.rows.find(r => r.role === 'FARMER')?.count || 0,
            total_customers: userStats.rows.find(r => r.role === 'CUSTOMER')?.count || 0,
            total_products: productStats.rows.reduce((sum, row) => sum + parseInt(row.count), 0),
            available_products: productStats.rows.find(r => r.status === 'AVAILABLE')?.count || 0,
            pending_products: productStats.rows.find(r => r.status === 'PENDING')?.count || 0,
            total_orders: orderStats.rows.reduce((sum, row) => sum + parseInt(row.count), 0),
            pending_orders,
            completed_orders,
            total_revenue: parseFloat(totalRevenue.rows[0]?.total || 0)
        };

        res.json({ summary, analytics: { userStats: userStats.rows, productStats: productStats.rows, orderStats: orderStats.rows } });
    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

/* =====================================================
   ⚙️ SYSTEM SETTINGS & LOGS
===================================================== */
const getSystemLogs = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM admin_actions
             ORDER BY created_at DESC
             LIMIT 100`
        );
        res.json({ logs: result.rows });
    } catch (error) {
        console.error('Get logs error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const updateSystemSettings = async (req, res) => {
    try {
        const { settings } = req.body;
        // In a real app, you'd store this in a settings table.
        // For now, we just return success.
        res.json({
            success: true,
            message: 'Settings updated (mock)',
            settings
        });
    } catch (error) {
        console.error('Update settings error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = {
    createFirstAdmin,
    getAllUsers,
    getUserDetails,
    updateUserStatus,
    updateUserRole,
    verifyFarmer,
    getPendingVerifications,
    getAllProducts,
    updateProductStatus,
    getAllOrders,
    updateOrder,
    getSystemAnalytics,    
    getSystemLogs,
    updateSystemSettings
};