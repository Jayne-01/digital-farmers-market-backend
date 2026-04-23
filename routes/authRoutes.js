const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'Digital-Farm-Market',
    password: process.env.DB_PASSWORD || '010124',
    port: process.env.DB_PORT || 5432,
});

const isMaintenanceMode = async () => {
    try {
        const result = await pool.query('SELECT maintenance_mode FROM system_settings LIMIT 1');
        return result.rows[0]?.maintenance_mode === true;
    } catch (error) {
        return false;
    }
};

// Maintenance check middleware for API routes
const checkMaintenanceForAPI = async (req, res, next) => {
    try {
        const maintenanceMode = await isMaintenanceMode();
        if (maintenanceMode && req.user && req.user.role !== 'ADMIN') {
            return res.status(503).json({ 
                success: false, 
                maintenance: true,
                message: 'System is under maintenance. Please try again later.',
                redirect: '/maintenance.html'
            });
        }
        next();
    } catch (error) {
        next();
    }
};

router.get('/maintenance-status', async (req, res) => {
    try {
        const maintenanceMode = await isMaintenanceMode();
        res.json({ maintenance_mode: maintenanceMode });
    } catch (error) {
        res.json({ maintenance_mode: false });
    }
});

const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ success: false, error: 'Access token required' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');

        const userResult = await pool.query(
            'SELECT user_id, role, status FROM users WHERE user_id = $1',
            [decoded.user_id]
        );

        if (userResult.rows.length === 0) {
            return res.status(401).json({ success: false, error: 'User no longer exists' });
        }

        if (userResult.rows[0].status !== 'ACTIVE') {
            return res.status(403).json({ success: false, error: 'Account is deactivated' });
        }

        req.user = {
            ...decoded,
            ...userResult.rows[0],
            id: decoded.user_id,
            user_id: decoded.user_id
        };
        
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(403).json({ success: false, error: 'Invalid token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(403).json({ success: false, error: 'Token expired' });
        }
        console.error('Auth middleware error:', error);
        res.status(500).json({ success: false, error: 'Authentication error' });
    }
};

router.post('/register', async (req, res) => {
    try {
        const maintenanceMode = await isMaintenanceMode();
        if (maintenanceMode) {
            return res.status(503).json({
                success: false,
                maintenance: true,
                message: 'System is under maintenance. Registration is disabled.'
            });
        }
        
        const { full_name, email, password, confirm_password, contact_number, barangay, address } = req.body;
        
        if (!full_name || !email || !password || !confirm_password) {
            return res.status(400).json({ success: false, message: 'Full name, email, password and confirmation are required' });
        }
        
        if (password !== confirm_password) {
            return res.status(400).json({ success: false, message: 'Passwords do not match' });
        }
        
        const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'Email already registered' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await pool.query(
            `INSERT INTO users (full_name, email, password, role, contact_number, barangay, address, status, created_at)
             VALUES ($1, $2, $3, 'CUSTOMER', $4, $5, $6, 'ACTIVE', NOW())
             RETURNING user_id, full_name, email, role, contact_number, barangay, address`,
            [full_name, email, hashedPassword, contact_number || null, barangay || null, address || null]
        );
        
        const user = result.rows[0];
        
        const token = jwt.sign(
            { user_id: user.user_id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'your-secret-key-change-in-production',
            { expiresIn: '7d' }
        );
        
        res.status(201).json({ success: true, message: 'Registration successful!', token, user });
        
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required' });
        }
        
        const maintenanceMode = await isMaintenanceMode();
        
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }
        
        const user = result.rows[0];
        
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }
        
        if (user.status !== 'ACTIVE') {
            return res.status(403).json({ success: false, message: 'Account is deactivated' });
        }
        
        if (maintenanceMode && user.role !== 'ADMIN') {
            return res.status(503).json({
                success: false,
                maintenance: true,
                message: 'System is under maintenance. Only administrators can access the system at this time.'
            });
        }
        
        let farmer_id = null;
        let isVerifiedFarmer = false;
        
        if (user.role === 'FARMER') {
            const farmerResult = await pool.query('SELECT farmer_id, verified_status FROM farmers WHERE user_id = $1', [user.user_id]);
            if (farmerResult.rows.length > 0) {
                farmer_id = farmerResult.rows[0].farmer_id;
                isVerifiedFarmer = farmerResult.rows[0].verified_status;
                if (!isVerifiedFarmer) {
                    user.role = 'CUSTOMER';
                }
            }
        }
        
        const token = jwt.sign(
            { user_id: user.user_id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'your-secret-key-change-in-production',
            { expiresIn: '7d' }
        );
        
        delete user.password;
        user.farmer_id = farmer_id;
        user.is_verified_farmer = isVerifiedFarmer;
        
        res.status(200).json({
            success: true,
            message: 'Login successful!',
            token,
            user,
            maintenance_mode: maintenanceMode
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Apply maintenance check to ALL protected routes
router.get('/profile', authenticateToken, checkMaintenanceForAPI, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.user_id, u.full_name, u.email, u.role, u.contact_number, 
                    u.address, u.barangay, u.status, u.created_at, u.updated_at,
                    f.farmer_id, f.farm_name, f.verified_status
             FROM users u
             LEFT JOIN farmers f ON u.user_id = f.user_id
             WHERE u.user_id = $1`,
            [req.user.user_id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        res.json({ success: true, user: result.rows[0] });
        
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ success: false, error: 'Failed to get profile' });
    }
});

router.put('/update-profile', authenticateToken, checkMaintenanceForAPI, async (req, res) => {
    try {
        const { full_name, contact_number, address, barangay } = req.body;
        const userId = req.user.user_id;
        
        let updateFields = [];
        let values = [];
        let paramCount = 1;
        
        if (full_name !== undefined) {
            updateFields.push(`full_name = $${paramCount}`);
            values.push(full_name);
            paramCount++;
        }
        
        if (contact_number !== undefined) {
            updateFields.push(`contact_number = $${paramCount}`);
            values.push(contact_number || null);
            paramCount++;
        }
        
        if (address !== undefined) {
            updateFields.push(`address = $${paramCount}`);
            values.push(address || null);
            paramCount++;
        }
        
        if (barangay !== undefined) {
            updateFields.push(`barangay = $${paramCount}`);
            values.push(barangay || null);
            paramCount++;
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({ success: false, error: 'At least one field must be provided for update' });
        }
        
        updateFields.push(`updated_at = NOW()`);
        values.push(userId);
        
        const query = `
            UPDATE users 
            SET ${updateFields.join(', ')}
            WHERE user_id = $${paramCount}
            RETURNING user_id, full_name, email, role, contact_number, address, barangay, created_at, updated_at
        `;
        
        const result = await pool.query(query, values);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: result.rows[0]
        });
        
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ success: false, error: 'Failed to update profile' });
    }
});

module.exports = router;