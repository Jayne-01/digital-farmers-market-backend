const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config();

//import routes
const productRoutes = require('./routes/productRoutes');
const adminRoutes = require('./routes/adminRoutes');
const farmerRoutes = require('./routes/farmerRoutes');
const orderRoutes = require('./routes/orderRoutes');
const recommendationRoutes = require('./routes/recommendationRoutes');
const cartRoutes = require('./routes/cartRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');

const app = express();

// Database connection
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'digital_market',
    password: process.env.DB_PASSWORD || 'password',
    port: process.env.DB_PORT || 5432,
});

// Make db available to routes
app.locals.db = pool;
app.locals.pool = pool;

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Test database connection
pool.connect()
    .then(() => console.log('✅ Connected to PostgreSQL database'))
    .catch(err => console.error('❌ Database connection error:', err));

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use('/uploads', express.static('uploads'));
app.use(express.static('C:/Users/Jorinna/OneDrive/Desktop/digital-farmers-market-frontend'));

// Request logging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// Health check
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.status(200).json({ 
            status: 'OK',
            database: 'Connected',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'ERROR',
            database: 'Disconnected',
            error: error.message 
        });
    }
});

// ========== WORKING REGISTER ENDPOINT ==========
app.post('/api/auth/register', async (req, res) => {
    console.log('🔥 Register endpoint called');
    console.log('Request body:', req.body);
    
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
        
        // Validation
        if (!full_name || !email || !password) {
            return res.status(400).json({ 
                success: false,
                error: 'Missing required fields',
                required: ['full_name', 'email', 'password']
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
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            RETURNING user_id, full_name, email, role, contact_number, address, barangay, created_at`,
            [
                full_name, 
                email, 
                hashedPassword, 
                role, 
                contact_number || null, 
                address || null,
                barangay || null
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

// ========== WORKING LOGIN ENDPOINT (UPDATED WITH FARMER_ID) ==========
app.post('/api/auth/login', async (req, res) => {
    console.log('🔥 Login endpoint called');
    
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
        
        // Get farmer_id if user is a farmer
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
                role: user.role 
            },
            process.env.JWT_SECRET || 'your-secret-key-change-in-production',
            { expiresIn: '7d' }
        );
        
        delete user.password;
        
        // Add farmer_id to user object
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

// Get user profile (UPDATED WITH FARMER_ID)
app.get('/api/auth/profile', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ 
                success: false,
                error: 'No token provided' 
            });
        }
        
        const decoded = jwt.verify(
            token, 
            process.env.JWT_SECRET || 'your-secret-key-change-in-production'
        );
        
        const result = await pool.query(
            `SELECT u.user_id, u.full_name, u.email, u.role, u.contact_number, 
                    u.address, u.barangay, u.created_at, f.farmer_id
             FROM users u
             LEFT JOIN farmers f ON u.user_id = f.user_id
             WHERE u.user_id = $1`,
            [decoded.user_id]
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
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ 
                success: false,
                error: 'Invalid token' 
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Failed to get profile'
        });
    }
});

// ========== UPDATE USER PROFILE ==========
app.put('/api/auth/update-profile', async (req, res) => {
    console.log('🔥 Update profile endpoint called');
    
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ 
                success: false,
                error: 'No token provided' 
            });
        }
        
        const decoded = jwt.verify(
            token, 
            process.env.JWT_SECRET || 'your-secret-key-change-in-production'
        );
        
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
        values.push(decoded.user_id);
        
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
        
        // Get farmer_id if user is a farmer
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

// ========== REGISTER AS FARMER (UPDATED TO RETURN FARMER_ID) ==========
app.post('/api/auth/register-farmer', async (req, res) => {
    console.log('🔥 FARMER REGISTRATION CALLED');
    console.log('📦 Request body:', req.body);

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({
                success: false,
                error: 'No token provided'
            });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');

        const { farm_name, farm_location, farm_description } = req.body;

        if (!farm_name) {
            return res.status(400).json({
                success: false,
                error: 'Farm name is required'
            });
        }

        const existingFarmer = await pool.query(
            'SELECT farmer_id FROM farmers WHERE user_id = $1',
            [decoded.user_id]
        );

        if (existingFarmer.rows.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Farmer profile already exists',
                farmer_id: existingFarmer.rows[0].farmer_id
            });
        }

        const result = await pool.query(
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
                decoded.user_id,
                farm_name,
                farm_location || null,
                farm_description || null,
                false
            ]
        );

        console.log('✅ Farmer inserted successfully!');
        console.log('   - Farmer ID:', result.rows[0].farmer_id);

        await pool.query(
            'UPDATE users SET role = $1 WHERE user_id = $2',
            ['FARMER', decoded.user_id]
        );

        const userResult = await pool.query(
            `SELECT u.user_id, u.full_name, u.email, u.role, u.contact_number, 
                    u.address, u.barangay, f.farmer_id
             FROM users u
             LEFT JOIN farmers f ON u.user_id = f.user_id
             WHERE u.user_id = $1`,
            [decoded.user_id]
        );

        res.status(201).json({
            success: true,
            message: 'Farmer registration submitted successfully',
            farmer: result.rows[0],
            user: userResult.rows[0],
            note: 'Pending verification'
        });

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
    console.log('🔥 Create first admin endpoint called');
    
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

app.post('/api/auth/admin/register', async (req, res) => {
    console.log('🔥 Admin registration endpoint called');
    
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ 
                success: false,
                error: 'Admin token required' 
            });
        }
        
        const decoded = jwt.verify(
            token, 
            process.env.JWT_SECRET || 'your-secret-key-change-in-production'
        );
        
        const adminCheck = await pool.query(
            'SELECT * FROM users WHERE user_id = $1 AND role = $2',
            [decoded.user_id, 'ADMIN']
        );
        
        if (adminCheck.rows.length === 0) {
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
    console.log('🔥 Admin login endpoint called');
    
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
                role: admin.role 
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

app.get('/api/auth/admin/users', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ 
                success: false,
                error: 'Admin token required' 
            });
        }
        
        const decoded = jwt.verify(
            token, 
            process.env.JWT_SECRET || 'your-secret-key-change-in-production'
        );
        
        const adminCheck = await pool.query(
            'SELECT * FROM users WHERE user_id = $1 AND role = $2',
            [decoded.user_id, 'ADMIN']
        );
        
        if (adminCheck.rows.length === 0) {
            return res.status(403).json({ 
                success: false,
                error: 'Admin access required' 
            });
        }
        
        const usersResult = await pool.query(
            `SELECT user_id, full_name, email, role, contact_number, address, barangay, status, created_at 
             FROM users 
             ORDER BY created_at DESC`
        );
        
        res.json({
            success: true,
            count: usersResult.rows.length,
            users: usersResult.rows
        });
        
    } catch (error) {
        console.error('Get users error:', error);
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ 
                success: false,
                error: 'Invalid token' 
            });
        }
        
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
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        availableEndpoints: [
            'POST /api/auth/register',
            'POST /api/auth/login',
            'GET /api/auth/profile',
            'PUT /api/auth/update-profile',
            'POST /api/auth/register-farmer',
            'POST /api/auth/create-first-admin',
            'POST /api/auth/admin/register',
            'POST /api/auth/admin/login',
            'GET /api/auth/admin/users',
            'GET /api/products',
            'GET /api/products/:id',
            'GET /api/orders/farmer',
            'GET /api/orders/my-purchases',
            'GET /api/orders/:id',
            'PUT /api/orders/:id/status',
            'PUT /api/orders/:id/cancel',
            'GET /api/cart',
            'POST /api/cart/add',
            'GET /api/cart/count',
            'PUT /api/cart/update/:id',
            'DELETE /api/cart/remove/:id',
            'DELETE /api/cart/clear',
            'POST /api/cart/checkout',
            'GET /health',
            'GET /api/feedback',
            'POST /api/feedback'
        ]
    });
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 DIGITAL MARKET BACKEND SERVER');
    console.log('='.repeat(60));
    console.log(`✅ Server running on: http://localhost:${PORT}`);
    console.log('='.repeat(60) + '\n');
});