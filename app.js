const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config();

// Import routes
const productRoutes = require('./routes/productRoutes');
const adminRoutes = require('./routes/adminRoutes');
const farmerRoutes = require('./routes/farmerRoutes');
const orderRoutes = require('./routes/orderRoutes');
const recommendationRoutes = require('./routes/recommendationRoutes');
const cartRoutes = require('./routes/cartRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');
const classifyRoutes = require('./routes/classify');

const app = express();

// Database connection with improved configuration
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'Digital-Farm-Market',
    password: process.env.DB_PASSWORD || '010124',
    port: process.env.DB_PORT || 5432,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Make db available to routes
app.locals.db = pool;
app.locals.pool = pool;

// Test database connection with retry logic
const connectWithRetry = async () => {
    try {
        await pool.connect();
        console.log('✅ Connected to PostgreSQL database');
        
        const testResult = await pool.query('SELECT NOW() as current_time');
        console.log(`   Database time: ${testResult.rows[0].current_time}`);
    } catch (err) {
        console.error('❌ Database connection error:', err.message);
        console.log('🔄 Retrying in 5 seconds...');
        setTimeout(connectWithRetry, 5000);
    }
};

connectWithRetry();

// Handle pool errors
pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

// Middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:5000', 'http://127.0.0.1:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static('C:/Users/Jorinna/OneDrive/Desktop/digital-farmers-market-frontend'));

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
    });
    next();
});

// Health check with more details
app.get('/health', async (req, res) => {
    try {
        const dbResult = await pool.query('SELECT 1 as alive');
        const dbTime = await pool.query('SELECT NOW() as time');
        
        res.status(200).json({ 
            status: 'OK',
            database: 'Connected',
            database_time: dbTime.rows[0].time,
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage()
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'ERROR',
            database: 'Disconnected',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ========== AUTHENTICATION MIDDLEWARE ==========
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ 
                success: false, 
                error: 'Access token required' 
            });
        }

        const decoded = jwt.verify(
            token, 
            process.env.JWT_SECRET || 'your-secret-key-change-in-production'
        );

        const userResult = await pool.query(
            'SELECT user_id, role, status FROM users WHERE user_id = $1',
            [decoded.user_id]
        );

        if (userResult.rows.length === 0) {
            return res.status(401).json({ 
                success: false, 
                error: 'User no longer exists' 
            });
        }

        if (userResult.rows[0].status !== 'ACTIVE') {
            return res.status(403).json({ 
                success: false, 
                error: 'Account is deactivated' 
            });
        }

        req.user = {
            ...decoded,
            ...userResult.rows[0],
            id: decoded.user_id
        };
        
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(403).json({ 
                success: false, 
                error: 'Invalid token' 
            });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(403).json({ 
                success: false, 
                error: 'Token expired' 
            });
        }
        console.error('Auth middleware error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Authentication error' 
        });
    }
};

// Role authorization middleware
const authorizeRole = (roles) => {
    return (req, res, next) => {
        console.log('=== AUTHORIZE ROLE CALLED ===');
        console.log('Roles passed:', roles);
        console.log('User role from JWT:', req.user?.role);
        
        if (!req.user) {
            return res.status(401).json({ 
                success: false, 
                error: 'Unauthorized: No user data' 
            });
        }
        
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ 
                success: false, 
                error: `Access denied. Required role: ${roles.join(' or ')}` 
            });
        }
        
        console.log('✅ Role check PASSED!');
        next();
    };
};

// ========== AUTH ENDPOINTS ==========

/**
 * @route   POST /api/auth/register
 * @desc    Register a new customer
 * @access  Public
 */
app.post('/api/auth/register', async (req, res) => {
    console.log('📝 Register endpoint called');
    
    try {
        const { 
            full_name, 
            email, 
            password, 
            confirm_password,
            contact_number, 
            address,
            barangay 
        } = req.body;
        
        const validationErrors = [];
        
        if (!full_name) validationErrors.push('Full name is required');
        if (!email) validationErrors.push('Email is required');
        if (!password) validationErrors.push('Password is required');
        
        if (validationErrors.length > 0) {
            return res.status(400).json({ 
                success: false,
                error: 'Validation failed',
                details: validationErrors
            });
        }
        
        if (password !== confirm_password) {
            return res.status(400).json({ 
                success: false,
                error: 'Passwords do not match'
            });
        }
        
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ 
                success: false,
                error: 'Invalid email format'
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ 
                success: false,
                error: 'Password must be at least 6 characters long'
            });
        }
        
        const role = 'CUSTOMER';
        
        const userCheck = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );
        
        if (userCheck.rows.length > 0) {
            return res.status(400).json({ 
                success: false,
                error: 'Email already registered'
            });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await pool.query(
            `INSERT INTO users (
                full_name, 
                email, 
                password, 
                role, 
                contact_number, 
                address,
                barangay,
                status,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING user_id, full_name, email, role, contact_number, address, barangay, created_at`,
            [
                full_name, 
                email, 
                hashedPassword, 
                role, 
                contact_number || null, 
                address || null,
                barangay || null,
                'ACTIVE'
            ]
        );
        
        const user = result.rows[0];
        
        const token = jwt.sign(
            { 
                user_id: user.user_id, 
                email: user.email, 
                role: user.role 
            },
            process.env.JWT_SECRET || 'your-secret-key-change-in-production',
            { expiresIn: '7d' }
        );
        
        console.log('✅ User registered successfully:', user.email);
        
        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            token,
            user
        });
        
    } catch (error) {
        console.error('❌ Registration error:', error);
        
        let errorMessage = 'Registration failed';
        let statusCode = 500;
        
        if (error.code === '23505') {
            errorMessage = 'Email already exists';
            statusCode = 400;
        } else if (error.code === '23502') {
            errorMessage = 'Missing required fields';
            statusCode = 400;
        } else if (error.code === '42703') {
            errorMessage = 'Invalid field in request';
            statusCode = 400;
        }
        
        res.status(statusCode).json({
            success: false,
            error: errorMessage,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * @route   POST /api/auth/login
 * @desc    Login user
 * @access  Public
 */
app.post('/api/auth/login', async (req, res) => {
    console.log('🔑 Login endpoint called');
    
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                success: false,
                error: 'Email and password are required' 
            });
        }
        
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ 
                success: false,
                error: 'Invalid email or password' 
            });
        }
        
        const user = result.rows[0];
        
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ 
                success: false,
                error: 'Invalid email or password' 
            });
        }
        
        if (user.status !== 'ACTIVE') {
            return res.status(403).json({ 
                success: false,
                error: 'Account is deactivated. Please contact support.' 
            });
        }
        
        let farmer_id = null;
        if (user.role === 'FARMER') {
            const farmerResult = await pool.query(
                'SELECT farmer_id FROM farmers WHERE user_id = $1',
                [user.user_id]
            );
            if (farmerResult.rows.length > 0) {
                farmer_id = farmerResult.rows[0].farmer_id;
            }
        }
        
        const token = jwt.sign(
            { 
                user_id: user.user_id, 
                email: user.email, 
                role: user.role,
                id: user.user_id
            },
            process.env.JWT_SECRET || 'your-secret-key-change-in-production',
            { expiresIn: '7d' }
        );
        
        delete user.password;
        
        user.farmer_id = farmer_id;
        
        console.log('✅ User logged in:', user.email);
        console.log('✅ Farmer ID:', farmer_id);
        
        res.json({
            success: true,
            message: 'Login successful',
            token,
            user
        });
        
    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Login failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * @route   GET /api/auth/profile
 * @desc    Get user profile
 * @access  Private
 */
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
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
            return res.status(404).json({ 
                success: false,
                error: 'User not found' 
            });
        }
        
        res.json({
            success: true,
            user: result.rows[0]
        });
        
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get profile'
        });
    }
});

/**
 * @route   PUT /api/auth/update-profile
 * @desc    Update user profile
 * @access  Private
 */
app.put('/api/auth/update-profile', authenticateToken, async (req, res) => {
    console.log('📝 Update profile endpoint called');
    
    try {
        const { 
            full_name, 
            contact_number, 
            address,
            barangay 
        } = req.body;
        
        if (!full_name && !contact_number && !address && !barangay) {
            return res.status(400).json({ 
                success: false,
                error: 'At least one field must be provided for update'
            });
        }
        
        let updateFields = [];
        let values = [];
        let paramCount = 1;
        
        if (full_name) {
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
        
        updateFields.push(`updated_at = NOW()`);
        values.push(req.user.user_id);
        
        const result = await pool.query(
            `UPDATE users 
             SET ${updateFields.join(', ')}
             WHERE user_id = $${paramCount}
             RETURNING user_id, full_name, email, role, contact_number, address, barangay, created_at, updated_at`,
            values
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'User not found' 
            });
        }
        
        const updatedUser = result.rows[0];
        
        if (updatedUser.role === 'FARMER') {
            const farmerResult = await pool.query(
                'SELECT farmer_id FROM farmers WHERE user_id = $1',
                [updatedUser.user_id]
            );
            if (farmerResult.rows.length > 0) {
                updatedUser.farmer_id = farmerResult.rows[0].farmer_id;
            }
        }
        
        console.log('✅ Profile updated for user:', updatedUser.email);
        
        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: updatedUser
        });
        
    } catch (error) {
        console.error('❌ Update profile error:', error);
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ 
                success: false,
                error: 'Invalid token' 
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Failed to update profile',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * @route   POST /api/auth/register-farmer
 * @desc    Register as a farmer
 * @access  Private
 */
app.post('/api/auth/register-farmer', authenticateToken, async (req, res) => {
    console.log('🌾 Farmer registration called for user:', req.user.user_id);

    try {
        const { farm_name, farm_location, farm_description } = req.body;

        if (!farm_name) {
            return res.status(400).json({
                success: false,
                error: 'Farm name is required'
            });
        }

        const existingFarmer = await pool.query(
            'SELECT farmer_id FROM farmers WHERE user_id = $1',
            [req.user.user_id]
        );

        if (existingFarmer.rows.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Farmer profile already exists',
                farmer_id: existingFarmer.rows[0].farmer_id
            });
        }

        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const result = await client.query(
                `INSERT INTO farmers (
                    user_id,
                    farm_name,
                    barangay,
                    farm_description,
                    verified_status,
                    created_at
                )
                VALUES ($1, $2, $3, $4, $5, NOW())
                RETURNING
                    farmer_id,
                    farm_name,
                    barangay,
                    farm_description,
                    verified_status,
                    created_at`,
                [
                    req.user.user_id,
                    farm_name,
                    farm_location || null,
                    farm_description || null,
                    false
                ]
            );

            await client.query(
                'UPDATE users SET role = $1, updated_at = NOW() WHERE user_id = $2',
                ['FARMER', req.user.user_id]
            );

            await client.query('COMMIT');

            console.log('✅ Farmer registered successfully!');
            console.log('   - Farmer ID:', result.rows[0].farmer_id);

            const userResult = await pool.query(
                `SELECT u.user_id, u.full_name, u.email, u.role, u.contact_number, 
                        u.address, u.barangay, f.farmer_id
                 FROM users u
                 LEFT JOIN farmers f ON u.user_id = f.user_id
                 WHERE u.user_id = $1`,
                [req.user.user_id]
            );

            res.status(201).json({
                success: true,
                message: 'Farmer registration submitted successfully',
                farmer: result.rows[0],
                user: userResult.rows[0],
                note: 'Pending verification'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('❌ Farmer registration error:', error);

        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                error: 'Invalid token'
            });
        }

        res.status(500).json({
            success: false,
            error: 'Failed to register as farmer',
            details: error.message
        });
    }
});

// ========== ADMIN ENDPOINTS ==========
app.post('/api/auth/create-first-admin', async (req, res) => {
    console.log('👑 Create first admin endpoint called');
    
    try {
        const adminCheck = await pool.query(
            'SELECT * FROM users WHERE role = $1',
            ['ADMIN']
        );
        
        if (adminCheck.rows.length > 0) {
            return res.status(403).json({ 
                success: false,
                error: 'Admin already exists. Use admin registration endpoint instead.'
            });
        }
        
        const { 
            full_name, 
            email, 
            password, 
            confirm_password,
            contact_number
        } = req.body;
        
        if (!full_name || !email || !password || !confirm_password) {
            return res.status(400).json({ 
                success: false,
                error: 'All fields are required',
                required: ['full_name', 'email', 'password', 'confirm_password']
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
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await pool.query(
            `INSERT INTO users (
                full_name, 
                email, 
                password, 
                role, 
                contact_number,
                status,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
            RETURNING user_id, full_name, email, role, contact_number, status, created_at`,
            [
                full_name, 
                email, 
                hashedPassword, 
                'ADMIN',
                contact_number || null,
                'ACTIVE'
            ]
        );
        
        const adminUser = result.rows[0];
        
        const token = jwt.sign(
            { 
                user_id: adminUser.user_id, 
                email: adminUser.email, 
                role: adminUser.role 
            },
            process.env.JWT_SECRET || 'your-secret-key-change-in-production',
            { expiresIn: '7d' }
        );
        
        console.log('✅ First admin created successfully:', adminUser.email);
        
        res.status(201).json({
            success: true,
            message: 'First admin created successfully',
            token,
            admin: adminUser,
            warning: 'Save this token securely. Use it to register additional admins.'
        });
        
    } catch (error) {
        console.error('❌ First admin creation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create first admin',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

app.post('/api/auth/admin/register', authenticateToken, async (req, res) => {
    console.log('👥 Admin registration endpoint called by:', req.user.email);
    
    try {
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ 
                success: false,
                error: 'Only administrators can register new admins' 
            });
        }
        
        const { 
            full_name, 
            email, 
            password, 
            confirm_password,
            contact_number, 
            address,
            barangay
        } = req.body;
        
        if (!full_name || !email || !password || !confirm_password) {
            return res.status(400).json({ 
                success: false,
                error: 'Full name, email, password and confirmation are required'
            });
        }
        
        if (password !== confirm_password) {
            return res.status(400).json({ 
                success: false,
                error: 'Passwords do not match'
            });
        }
        
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ 
                success: false,
                error: 'Invalid email format'
            });
        }
        
        if (password.length < 8) {
            return res.status(400).json({ 
                success: false,
                error: 'Admin password must be at least 8 characters long'
            });
        }
        
        const userCheck = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );
        
        if (userCheck.rows.length > 0) {
            return res.status(400).json({ 
                success: false,
                error: 'Email already registered'
            });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await pool.query(
            `INSERT INTO users (
                full_name, 
                email, 
                password, 
                role, 
                contact_number, 
                address,
                barangay,
                status,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING user_id, full_name, email, role, contact_number, address, barangay, status, created_at`,
            [
                full_name, 
                email, 
                hashedPassword, 
                'ADMIN',
                contact_number || null, 
                address || null,
                barangay || null,
                'ACTIVE'
            ]
        );
        
        const adminUser = result.rows[0];
        
        const adminToken = jwt.sign(
            { 
                user_id: adminUser.user_id, 
                email: adminUser.email, 
                role: adminUser.role 
            },
            process.env.JWT_SECRET || 'your-secret-key-change-in-production',
            { expiresIn: '7d' }
        );
        
        console.log('✅ New admin registered:', adminUser.email);
        
        res.status(201).json({
            success: true,
            message: 'Admin registered successfully',
            token: adminToken,
            admin: adminUser
        });
        
    } catch (error) {
        console.error('❌ Admin registration error:', error);
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ 
                success: false,
                error: 'Invalid admin token' 
            });
        }
        
        let errorMessage = 'Admin registration failed';
        let statusCode = 500;
        
        if (error.code === '23505') {
            errorMessage = 'Email already exists';
            statusCode = 400;
        }
        
        res.status(statusCode).json({
            success: false,
            error: errorMessage,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

app.post('/api/auth/admin/login', async (req, res) => {
    console.log('👑 Admin login endpoint called');
    
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                success: false,
                error: 'Email and password are required' 
            });
        }
        
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND role = $2',
            [email, 'ADMIN']
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ 
                success: false,
                error: 'Invalid admin credentials' 
            });
        }
        
        const admin = result.rows[0];
        
        const validPassword = await bcrypt.compare(password, admin.password);
        if (!validPassword) {
            return res.status(401).json({ 
                success: false,
                error: 'Invalid admin credentials' 
            });
        }
        
        if (admin.status !== 'ACTIVE') {
            return res.status(403).json({ 
                success: false,
                error: 'Admin account is deactivated' 
            });
        }
        
        const token = jwt.sign(
            { 
                user_id: admin.user_id, 
                email: admin.email, 
                role: admin.role,
                id: admin.user_id
            },
            process.env.JWT_SECRET || 'your-secret-key-change-in-production',
            { expiresIn: '7d' }
        );
        
        delete admin.password;
        
        console.log('✅ Admin logged in:', admin.email);
        
        res.json({
            success: true,
            message: 'Admin login successful',
            token,
            admin
        });
        
    } catch (error) {
        console.error('❌ Admin login error:', error);
        res.status(500).json({
            success: false,
            error: 'Admin login failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

app.get('/api/auth/admin/users', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ 
                success: false,
                error: 'Admin access required' 
            });
        }
        
        const usersResult = await pool.query(
            `SELECT user_id, full_name, email, role, contact_number, address, barangay, status, created_at, updated_at
             FROM users 
             ORDER BY 
                CASE role 
                    WHEN 'ADMIN' THEN 1 
                    WHEN 'FARMER' THEN 2 
                    ELSE 3 
                END,
                created_at DESC`
        );
        
        res.json({
            success: true,
            count: usersResult.rows.length,
            users: usersResult.rows
        });
        
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get users'
        });
    }
});

// ========== ROUTES ==========
app.use('/api/products', productRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/farmers', farmerRoutes);

if (orderRoutes) {
    app.use('/api/orders', orderRoutes);
    console.log('✅ Order routes loaded successfully');
} else {
    console.error('❌ Order routes failed to load');
}

if (recommendationRoutes) {
    app.use('/api/recommendations', recommendationRoutes);
    console.log('✅ Recommendation routes loaded successfully');
} else {
    console.error('❌ Recommendation routes failed to load');
}

if (cartRoutes) {
    app.use('/api/cart', cartRoutes);
    console.log('✅ Cart routes loaded successfully');
} else {
    console.error('❌ Cart routes failed to load');
}

if (notificationRoutes) {
    app.use('/api/notifications', notificationRoutes);
    console.log('✅ Notification routes loaded successfully');
} else {
    console.error('❌ Notification routes failed to load');
}

if (feedbackRoutes) {
    app.use('/api/feedback', feedbackRoutes);
    console.log('✅ Feedback routes loaded successfully');
} else {
    console.error('❌ Feedback routes failed to load');
}

// ========== IMAGE CLASSIFIER ROUTES ==========
if (classifyRoutes) {
    app.use('/api', classifyRoutes);
    console.log('✅ Image Classifier routes loaded successfully');
    console.log('   - POST /api/classify');
    console.log('   - POST /api/classify/batch');
    console.log('   - POST /api/validate-product');
    console.log('   - GET  /api/classifier/health');
    console.log('   - GET  /api/classifier/classes');
} else {
    console.error('❌ Image Classifier routes failed to load');
}

// ========== ML MODEL INITIALIZATION ==========
// Initialize Random Forest ML model on startup
const randomForest = require('./services/ml/randomForestPredictor');

// Train model after database connection is established
setTimeout(async () => {
    console.log('🤖 Initializing Random Forest ML model...');
    await randomForest.trainModel();
    console.log('✅ ML model ready');
}, 5000);

// ========== ERROR HANDLING ==========
app.use((err, req, res, next) => {
    console.error('❌ Server error:', err.stack);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// 404 handler
app.use('*', (req, res) => {
    console.log(`❌ 404: ${req.method} ${req.originalUrl}`);
    
    const endpoints = {
        auth: [
            'POST /api/auth/register',
            'POST /api/auth/login',
            'GET /api/auth/profile',
            'PUT /api/auth/update-profile',
            'POST /api/auth/register-farmer'
        ],
        admin: [
            'POST /api/auth/create-first-admin',
            'POST /api/auth/admin/register',
            'POST /api/auth/admin/login',
            'GET /api/auth/admin/users'
        ],
        products: [
            'GET /api/products',
            'GET /api/products/:id',
            'GET /api/products/farmer/products',
            'POST /api/products',
            'PUT /api/products/:id',
            'DELETE /api/products/:id'
        ],
        farmers: [
            'GET /api/farmers/dashboard',
            'GET /api/farmers/profile',
            'PUT /api/farmers/profile'
        ],
        orders: [
            'GET /api/orders/farmer',
            'GET /api/orders/:id',
            'PUT /api/orders/:id/status'
        ],
        recommendations: [
            'GET /api/recommendations/farm-performance',
            'GET /api/recommendations/what-to-plant',
            'GET /api/recommendations/what-to-sell',
            'GET /api/recommendations/personalized-insights'
        ],
        cart: [
            'GET /api/cart',
            'POST /api/cart/add',
            'DELETE /api/cart/remove/:id'
        ],
        classifier: [
            'GET /api/classifier/health',
            'GET /api/classifier/classes',
            'POST /api/classify',
            'POST /api/classify/batch',
            'POST /api/validate-product'
        ],
        other: [
            'GET /health'
        ]
    };
    
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        message: `The requested endpoint ${req.method} ${req.originalUrl} does not exist`,
        available_endpoints: endpoints
    });
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

const server = app.listen(PORT, HOST, () => {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 DIGITAL FARMERS MARKET BACKEND SERVER');
    console.log('='.repeat(70));
    console.log(`📡 Server URL:      http://${HOST}:${PORT}`);
    console.log(`📊 Health check:    http://${HOST}:${PORT}/health`);
    console.log(`🕒 Started at:      ${new Date().toLocaleString()}`);
    console.log(`🔧 Environment:     ${process.env.NODE_ENV || 'development'}`);
    console.log(`💾 Database:        Digital-Farm-Market on ${process.env.DB_HOST || 'localhost'}`);
    console.log('='.repeat(70) + '\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        pool.end(() => {
            console.log('Database pool closed');
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        pool.end(() => {
            console.log('Database pool closed');
            process.exit(0);
        });
    });
});

module.exports = app;