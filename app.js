require('dotenv').config();
console.log('=== ENV VARIABLE CHECK ===');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'SET (length: ' + process.env.DATABASE_URL.length + ')' : 'NOT SET');
console.log('DB_USER:', process.env.DB_USER ? 'SET' : 'NOT SET');
console.log('NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('==========================');

const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { Pool } = require('pg');
const axios = require('axios');

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

// ========== CLASSIFIER KEEP-ALIVE PING ==========
// FIXED: Removed duplicate https:// - just use the URL directly
const CLASSIFIER_URL = process.env.CLASSIFIER_URL || 'https://farm-classifier.onrender.com';
const KEEP_ALIVE_INTERVAL = 4 * 60 * 1000; // Every 4 minutes

async function pingClassifier() {
    try {
        const response = await axios.get(`${CLASSIFIER_URL}/classify/health`, {
            timeout: 10000
        });
        if (response.data && response.data.status === 'healthy') {
            console.log('✅ Classifier keep-alive: Service is healthy');
        } else {
            console.log('⚠️ Classifier keep-alive: Service responded but status unknown');
        }
    } catch (error) {
        console.log('⚠️ Classifier keep-alive ping failed:', error.message);
    }
}

// Start keep-alive after server starts
setTimeout(() => {
    pingClassifier();
    setInterval(pingClassifier, KEEP_ALIVE_INTERVAL);
    console.log('🔄 Classifier keep-alive service started (pings every 4 minutes)');
}, 5000);
// ============================================

// ========== DATABASE CONNECTION CONFIGURATION ==========
let poolConfig;

// First try using DATABASE_URL (preferred method)
if (process.env.DATABASE_URL) {
    console.log('✅ Using DATABASE_URL for database connection');
    poolConfig = {
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false,
            require: true
        },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
    };
}
// Fallback to individual variables
else if (process.env.DB_USER && process.env.DB_HOST) {
    console.log('⚠️ Using individual database variables');
    poolConfig = {
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT || 5432,
        ssl: {
            rejectUnauthorized: false,
            require: true
        },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
    };
}
// Local development fallback
else {
    console.log('⚠️ Using local database configuration');
    poolConfig = {
        user: 'postgres',
        host: 'localhost',
        database: 'Digital-Farm-Market',
        password: '010124',
        port: 5432,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    };
}

const pool = new Pool(poolConfig);

// Make db available to routes
app.locals.db = pool;
app.locals.pool = pool;

// Test database connection with retry logic
const connectWithRetry = async (retryCount = 0) => {
    const maxRetries = 10;
    try {
        const client = await pool.connect();
        console.log('✅ Connected to PostgreSQL database successfully');
        
        const testResult = await client.query('SELECT NOW() as current_time, version() as version');
        console.log(`   Database time: ${testResult.rows[0].current_time}`);
        console.log(`   PostgreSQL version: ${testResult.rows[0].version.split(',')[0]}`);
        client.release();
    } catch (err) {
        console.error('❌ Database connection error:', err.message);
        if (retryCount < maxRetries) {
            console.log(`🔄 Retrying in 5 seconds... (Attempt ${retryCount + 1}/${maxRetries})`);
            setTimeout(() => connectWithRetry(retryCount + 1), 5000);
        } else {
            console.error('❌ Failed to connect to database after maximum retries');
            console.error('Please check your DATABASE_URL environment variable');
        }
    }
};

// Start connection attempt
connectWithRetry();

// Handle pool errors
pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
});

// ========== HELPER FUNCTION TO CHECK MAINTENANCE MODE ==========
async function isMaintenanceMode() {
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
        console.error('Maintenance check error:', error.message);
        return false;
    }
}

// ========== MAINTENANCE STATUS ENDPOINT (PUBLIC) ==========
app.get('/api/maintenance-status', async (req, res) => {
    try {
        const maintenance_mode = await isMaintenanceMode();
        console.log(`🔧 Maintenance mode is: ${maintenance_mode ? 'ON' : 'OFF'}`);
        res.json({ maintenance_mode });
    } catch (error) {
        console.error('❌ Maintenance status error:', error);
        res.json({ maintenance_mode: false });
    }
});

// ========== MAINTENANCE MODE MIDDLEWARE - ALLOWS ADMIN ==========
async function maintenanceMiddleware(req, res, next) {
    // Skip for maintenance status endpoint
    if (req.path === '/api/maintenance-status') {
        return next();
    }
    
    // Skip for admin API routes (so admin can login and turn off maintenance)
    if (req.path.startsWith('/api/admin')) {
        return next();
    }
    
    // Skip for admin auth endpoints
    if (req.path === '/api/auth/admin/login') {
        return next();
    }
    
    // Skip for static files
    if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf)$/)) {
        return next();
    }
    
    try {
        const maintenanceMode = await isMaintenanceMode();
        
        if (maintenanceMode) {
            // Check if this is an API request (starts with /api/)
            if (req.path.startsWith('/api/')) {
                // For API requests, return JSON 503
                return res.status(503).json({
                    success: false,
                    maintenance: true,
                    error: 'System is under maintenance. Please try again later.',
                    redirect: '/maintenance.html'
                });
            }
            
            // For HTML page requests, redirect to maintenance page
            return res.redirect('/maintenance.html');
        }
        
        next();
    } catch (error) {
        console.error('Maintenance middleware error:', error);
        next();
    }
}

// ========== GOOGLE OAUTH SETUP ==========
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${process.env.BACKEND_URL || 'http://localhost:3000'}/api/auth/google/callback`,
    passReqToCallback: true
  },
  async (req, accessToken, refreshToken, profile, done) => {
    try {
      console.log('🔍 Google profile received:', profile.emails[0].value);
      console.log('📛 Display name:', profile.displayName);
      
      // Check if user exists
      const existingUser = await pool.query(
        'SELECT * FROM users WHERE email = $1',
        [profile.emails[0].value]
      );

      let user;
      let isNewUser = false;

      if (existingUser.rows.length === 0) {
        // Create new user
        isNewUser = true;
        console.log('📝 Creating new user from Google account');
        
        const result = await pool.query(
          `INSERT INTO users (
            full_name, 
            email, 
            role, 
            contact_number, 
            address, 
            barangay, 
            status, 
            google_id, 
            created_at, 
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
          RETURNING user_id, full_name, email, role, contact_number, address, barangay, status, created_at`,
          [
            profile.displayName,
            profile.emails[0].value,
            'CUSTOMER',
            null,
            null,
            null,
            'ACTIVE',
            profile.id
          ]
        );
        user = result.rows[0];
        user.isNewUser = true;
      } else {
        user = existingUser.rows[0];
        user.isNewUser = false;
        console.log('📋 Existing user found:', user.email);
        
        // Update google_id if not set
        if (!user.google_id) {
          await pool.query(
            'UPDATE users SET google_id = $1, updated_at = NOW() WHERE user_id = $2',
            [profile.id, user.user_id]
          );
          console.log('🔄 Updated user with google_id');
        }
      }

      // Generate JWT token
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

      console.log('✅ Google authentication successful for:', user.email);
      return done(null, { user, token, isNewUser });
      
    } catch (error) {
      console.error('❌ Google Strategy Error:', error);
      return done(error, null);
    }
  }
));

passport.serializeUser((userData, done) => done(null, userData));
passport.deserializeUser((obj, done) => done(null, obj));

// ========== MIDDLEWARE ==========
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));
app.use(passport.initialize());

// Static files - MUST be before maintenance middleware
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static('C:/Users/Jorinna/OneDrive/Desktop/digital-farmers-market-frontend'));

// Apply maintenance middleware AFTER static files
app.use(maintenanceMiddleware);

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
        
        // ===== MAINTENANCE MODE CHECK IN AUTH - ALLOWS ADMIN =====
        const maintenanceMode = await isMaintenanceMode();
        if (maintenanceMode && req.user.role !== 'ADMIN') {
            return res.status(503).json({ 
                success: false, 
                maintenance: true,
                error: 'System is under maintenance. Please try again later.',
                redirect: '/maintenance.html'
            });
        }
        // ===== END MAINTENANCE MODE CHECK =====
        
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
    // Check maintenance mode first
    const maintenanceMode = await isMaintenanceMode();
    if (maintenanceMode) {
        return res.status(503).json({
            success: false,
            maintenance: true,
            error: 'System is under maintenance. Registration is disabled.'
        });
    }
    
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
        
        // Check maintenance mode - block non-admin logins
        const maintenanceMode = await isMaintenanceMode();
        if (maintenanceMode && user.role !== 'ADMIN') {
            return res.status(503).json({
                success: false,
                maintenance: true,
                error: 'System is under maintenance. Only administrators can login at this time.'
            });
        }
        
        let farmer_id = null;
        let isVerifiedFarmer = false;
        
        if (user.role === 'FARMER') {
            const farmerResult = await pool.query(
                'SELECT farmer_id, verified_status FROM farmers WHERE user_id = $1',
                [user.user_id]
            );
            if (farmerResult.rows.length > 0) {
                farmer_id = farmerResult.rows[0].farmer_id;
                isVerifiedFarmer = farmerResult.rows[0].verified_status;
                
                // If farmer is not verified, treat as customer
                if (!isVerifiedFarmer) {
                    user.role = 'CUSTOMER';
                }
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
        user.is_verified_farmer = isVerifiedFarmer;
        
        console.log('✅ User logged in:', user.email);
        console.log('✅ Role assigned:', user.role);
        
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

// ========== GOOGLE OAUTH ROUTES ==========

/**
 * @route   GET /api/auth/google
 * @desc    Initiate Google Sign-In
 * @access  Public
 */
app.get('/api/auth/google',
  passport.authenticate('google', { 
    scope: ['profile', 'email'],
    session: false 
  })
);

/**
 * @route   GET /api/auth/google/callback
 * @desc    Google OAuth Callback
 * @access  Public
 */
app.get('/api/auth/google/callback',
  passport.authenticate('google', { 
    failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=google_auth_failed`,
    session: false 
  }),
  (req, res) => {
    const { token, user, isNewUser } = req.user;
    
    // Redirect to frontend callback page
    const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth-callback.html?token=${token}&role=${user.role}&name=${encodeURIComponent(user.full_name)}&email=${encodeURIComponent(user.email)}&isNewUser=${isNewUser}`;
    
    console.log('🔄 Redirecting to:', redirectUrl);
    res.redirect(redirectUrl);
  }
);

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
    console.log('Request body:', req.body);
    
    try {
        const { 
            full_name, 
            contact_number, 
            address,
            barangay 
        } = req.body;
        
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
            return res.status(400).json({ 
                success: false,
                error: 'At least one field must be provided for update'
            });
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
                'SELECT farmer_id, verified_status FROM farmers WHERE user_id = $1',
                [updatedUser.user_id]
            );
            if (farmerResult.rows.length > 0) {
                updatedUser.farmer_id = farmerResult.rows[0].farmer_id;
                updatedUser.verified_status = farmerResult.rows[0].verified_status;
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

// ========== FARMER PROFILE UPDATE ENDPOINT ==========
/**
 * @route   PUT /api/farmers/profile
 * @desc    Update farmer profile
 * @access  Private (Farmer only)
 */
app.put('/api/farmers/profile', authenticateToken, async (req, res) => {
    console.log('🌾 Update farmer profile endpoint called');
    console.log('Request body:', req.body);
    console.log('User ID:', req.user.user_id);
    
    try {
        const { farm_name, barangay, farm_description } = req.body;
        const userId = req.user.user_id;
        
        // Check if farmer exists
        const checkQuery = await pool.query(
            'SELECT farmer_id, verified_status FROM farmers WHERE user_id = $1',
            [userId]
        );
        
        if (checkQuery.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Farmer profile not found. Please register as a farmer first.'
            });
        }
        
        // Check if farmer is verified
        if (!checkQuery.rows[0].verified_status) {
            return res.status(403).json({
                success: false,
                error: 'Cannot update profile. Your farmer application is pending approval.'
            });
        }
        
        // Build dynamic update query
        let updateFields = [];
        let values = [];
        let paramCount = 1;
        
        if (farm_name !== undefined) {
            updateFields.push(`farm_name = $${paramCount}`);
            values.push(farm_name);
            paramCount++;
        }
        
        if (barangay !== undefined) {
            updateFields.push(`barangay = $${paramCount}`);
            values.push(barangay || null);
            paramCount++;
        }
        
        if (farm_description !== undefined) {
            updateFields.push(`farm_description = $${paramCount}`);
            values.push(farm_description || null);
            paramCount++;
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No fields to update'
            });
        }
        
        updateFields.push(`updated_at = NOW()`);
        values.push(userId);
        
        const query = `
            UPDATE farmers 
            SET ${updateFields.join(', ')}
            WHERE user_id = $${paramCount}
            RETURNING farmer_id, farm_name, barangay, farm_description, verified_status, created_at, updated_at
        `;
        
        const result = await pool.query(query, values);
        
        console.log('✅ Farm profile updated for user:', userId);
        console.log('Updated data:', result.rows[0]);
        
        res.json({
            success: true,
            message: 'Farm profile updated successfully',
            farmer: result.rows[0]
        });
        
    } catch (error) {
        console.error('❌ Error updating farm profile:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update farm profile',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * @route   POST /api/auth/register-farmer
 * @desc    Register as a farmer (pending admin approval)
 * @access  Private
 */
app.post('/api/auth/register-farmer', authenticateToken, async (req, res) => {
    console.log('🌾 Farmer registration called for user:', req.user.user_id);

    try {
        const { farm_name, farm_location, farm_description } = req.body;

        // Check if user is already a verified farmer
        if (req.user.role === 'FARMER') {
            return res.status(400).json({
                success: false,
                error: 'You are already registered as a verified farmer'
            });
        }

        if (!farm_name) {
            return res.status(400).json({
                success: false,
                error: 'Farm name is required'
            });
        }

        // Check if farmer profile already exists
        const existingFarmer = await pool.query(
            'SELECT farmer_id, verified_status FROM farmers WHERE user_id = $1',
            [req.user.user_id]
        );

        if (existingFarmer.rows.length > 0) {
            const farmer = existingFarmer.rows[0];
            if (farmer.verified_status) {
                return res.status(400).json({
                    success: false,
                    error: 'Farmer profile already exists and is verified'
                });
            } else {
                return res.status(400).json({
                    success: false,
                    error: 'Farmer application already pending admin approval',
                    farmer_id: farmer.farmer_id,
                    status: 'PENDING'
                });
            }
        }

        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Insert farmer with verified_status = false (pending approval)
            const result = await client.query(
                `INSERT INTO farmers (
                    user_id,
                    farm_name,
                    barangay,
                    farm_description,
                    verified_status,
                    created_at,
                    updated_at
                )
                VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
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

            await client.query('COMMIT');

            console.log('✅ Farmer registration submitted for approval!');
            console.log('   - Farmer ID:', result.rows[0].farmer_id);
            console.log('   - Status: PENDING APPROVAL');

            res.status(201).json({
                success: true,
                message: 'Farmer registration submitted successfully. Your application is pending admin approval.',
                farmer: {
                    ...result.rows[0],
                    status: 'PENDING'
                },
                note: 'You will be notified once your application is approved or rejected.'
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
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// ========== ADMIN FARMER APPROVAL ENDPOINTS ==========

/**
 * @route   GET /api/auth/admin/pending-farmers
 * @desc    Get all pending farmer applications
 * @access  Admin only
 */
app.get('/api/auth/admin/pending-farmers', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    console.log('📋 Fetching pending farmer applications');

    try {
        const result = await pool.query(
            `SELECT 
                f.farmer_id,
                f.farm_name,
                f.barangay as farm_location,
                f.farm_description,
                f.verified_status,
                f.created_at as application_date,
                u.user_id,
                u.full_name,
                u.email,
                u.contact_number,
                u.address,
                u.barangay as user_barangay
             FROM farmers f
             JOIN users u ON f.user_id = u.user_id
             WHERE f.verified_status = false
             ORDER BY f.created_at ASC`,
            []
        );

        console.log(`Found ${result.rows.length} pending farmer applications`);

        res.json({
            success: true,
            count: result.rows.length,
            applications: result.rows.map(app => ({
                ...app,
                status: 'PENDING'
            }))
        });

    } catch (error) {
        console.error('Error fetching pending farmers:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch pending applications'
        });
    }
});

/**
 * @route   GET /api/auth/admin/all-farmers
 * @desc    Get all farmers (verified and pending)
 * @access  Admin only
 */
app.get('/api/auth/admin/all-farmers', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    console.log('📋 Fetching all farmers');

    try {
        const result = await pool.query(
            `SELECT 
                f.farmer_id,
                f.farm_name,
                f.barangay as farm_location,
                f.farm_description,
                f.verified_status,
                f.created_at as registration_date,
                f.updated_at,
                u.user_id,
                u.full_name,
                u.email,
                u.contact_number,
                u.address,
                u.barangay as user_barangay,
                u.status as user_status
             FROM farmers f
             JOIN users u ON f.user_id = u.user_id
             ORDER BY f.verified_status ASC, f.created_at DESC`,
            []
        );

        const farmers = result.rows.map(farmer => ({
            ...farmer,
            status: farmer.verified_status ? 'APPROVED' : 'PENDING'
        }));

        res.json({
            success: true,
            count: farmers.length,
            farmers: farmers
        });

    } catch (error) {
        console.error('Error fetching all farmers:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch farmers'
        });
    }
});

/**
 * @route   PUT /api/auth/admin/approve-farmer/:farmerId
 * @desc    Approve a farmer application
 * @access  Admin only
 */
app.put('/api/auth/admin/approve-farmer/:farmerId', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    console.log('✅ Admin approving farmer:', req.params.farmerId);

    const client = await pool.connect();

    try {
        const { farmerId } = req.params;

        await client.query('BEGIN');

        // Check if farmer exists and is not already verified
        const farmerCheck = await client.query(
            `SELECT f.farmer_id, f.user_id, f.verified_status, u.email, u.full_name, u.role
             FROM farmers f
             JOIN users u ON f.user_id = u.user_id
             WHERE f.farmer_id = $1`,
            [farmerId]
        );

        if (farmerCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'Farmer application not found'
            });
        }

        const farmer = farmerCheck.rows[0];

        if (farmer.verified_status === true) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'Farmer application has already been approved'
            });
        }

        // Update farmer verification status
        await client.query(
            `UPDATE farmers 
             SET verified_status = true, 
                 updated_at = NOW()
             WHERE farmer_id = $1`,
            [farmerId]
        );

        // Update user role to FARMER
        await client.query(
            `UPDATE users 
             SET role = 'FARMER', 
                 updated_at = NOW()
             WHERE user_id = $1`,
            [farmer.user_id]
        );

        await client.query('COMMIT');

        console.log('✅ Farmer application approved!');
        console.log('   - Farmer ID:', farmerId);
        console.log('   - User ID:', farmer.user_id);
        console.log('   - Email:', farmer.email);
        console.log('   - Name:', farmer.full_name);

        res.json({
            success: true,
            message: 'Farmer application approved successfully',
            farmer: {
                farmer_id: parseInt(farmerId),
                user_id: farmer.user_id,
                email: farmer.email,
                full_name: farmer.full_name,
                status: 'APPROVED'
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error approving farmer:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to approve farmer application'
        });
    } finally {
        client.release();
    }
});

/**
 * @route   DELETE /api/auth/admin/reject-farmer/:farmerId
 * @desc    Reject a farmer application
 * @access  Admin only
 */
app.delete('/api/auth/admin/reject-farmer/:farmerId', authenticateToken, authorizeRole(['ADMIN']), async (req, res) => {
    console.log('❌ Admin rejecting farmer:', req.params.farmerId);

    const client = await pool.connect();

    try {
        const { farmerId } = req.params;

        await client.query('BEGIN');

        // Check if farmer exists
        const farmerCheck = await client.query(
            `SELECT f.farmer_id, f.user_id, f.verified_status, u.email, u.full_name
             FROM farmers f
             JOIN users u ON f.user_id = u.user_id
             WHERE f.farmer_id = $1`,
            [farmerId]
        );

        if (farmerCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'Farmer application not found'
            });
        }

        const farmer = farmerCheck.rows[0];

        if (farmer.verified_status === true) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'Cannot reject an already approved farmer'
            });
        }

        // Delete the farmer application
        await client.query(
            `DELETE FROM farmers WHERE farmer_id = $1`,
            [farmerId]
        );

        await client.query('COMMIT');

        console.log('❌ Farmer application rejected and removed');
        console.log('   - Farmer ID:', farmerId);
        console.log('   - User ID:', farmer.user_id);
        console.log('   - Email:', farmer.email);
        console.log('   - Name:', farmer.full_name);

        res.json({
            success: true,
            message: 'Farmer application rejected successfully',
            rejected_farmer: {
                farmer_id: parseInt(farmerId),
                user_id: farmer.user_id,
                email: farmer.email,
                full_name: farmer.full_name
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error rejecting farmer:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reject farmer application'
        });
    } finally {
        client.release();
    }
});

/**
 * @route   GET /api/auth/farmer/status
 * @desc    Check farmer application status
 * @access  Private (any logged-in user)
 */
app.get('/api/auth/farmer/status', authenticateToken, async (req, res) => {
    console.log('🔍 Checking farmer status for user:', req.user.user_id);

    try {
        const result = await pool.query(
            `SELECT 
                f.farmer_id,
                f.farm_name,
                f.barangay as farm_location,
                f.farm_description,
                f.verified_status,
                f.created_at as application_date,
                f.updated_at
             FROM farmers f
             WHERE f.user_id = $1`,
            [req.user.user_id]
        );

        if (result.rows.length === 0) {
            return res.json({
                success: true,
                has_application: false,
                status: 'NOT_REGISTERED',
                message: 'You have not applied to become a farmer yet'
            });
        }

        const farmer = result.rows[0];
        let status = 'PENDING';
        let message = '';
        
        if (farmer.verified_status === true) {
            status = 'APPROVED';
            message = 'Your farmer application has been approved! You now have farmer access.';
        } else {
            status = 'PENDING';
            message = 'Your farmer application is pending admin approval. You will be notified once approved.';
        }

        res.json({
            success: true,
            has_application: true,
            status: status,
            farmer: {
                farmer_id: farmer.farmer_id,
                farm_name: farmer.farm_name,
                farm_location: farmer.farm_location,
                farm_description: farmer.farm_description,
                application_date: farmer.application_date,
                message: message
            }
        });

    } catch (error) {
        console.error('Error checking farmer status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check farmer application status'
        });
    }
});

/**
 * @route   GET /api/auth/farmer/profile
 * @desc    Get farmer profile (only if approved)
 * @access  Private (Farmer only)
 */
app.get('/api/auth/farmer/profile', authenticateToken, authorizeRole(['FARMER']), async (req, res) => {
    console.log('🌾 Fetching farmer profile for user:', req.user.user_id);

    try {
        // Check if user is actually a verified farmer
        const farmerCheck = await pool.query(
            `SELECT f.farmer_id, f.farm_name, f.barangay as farm_location, 
                    f.farm_description, f.verified_status, f.created_at, f.updated_at,
                    u.full_name, u.email, u.contact_number, u.address, u.barangay
             FROM farmers f
             JOIN users u ON f.user_id = u.user_id
             WHERE f.user_id = $1 AND f.verified_status = true`,
            [req.user.user_id]
        );

        if (farmerCheck.rows.length === 0) {
            return res.status(403).json({
                success: false,
                error: 'Access denied. Your farmer account has not been verified yet.'
            });
        }

        res.json({
            success: true,
            farmer: farmerCheck.rows[0]
        });

    } catch (error) {
        console.error('Error fetching farmer profile:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch farmer profile'
        });
    }
});

// ========== ADMIN ENDPOINTS ==========

/**
 * @route   POST /api/auth/create-first-admin
 * @desc    Create the first admin user
 * @access  Public (only works if no admin exists)
 */
app.post('/api/auth/create-first-admin', async (req, res) => {
    console.log('👑 Create first admin endpoint called');
    
    try {
        // Check if any admin already exists
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
            admin: adminUser
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

/**
 * @route   POST /api/auth/admin/register
 * @desc    Register a new admin (requires existing admin)
 * @access  Private (Admin only)
 */
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

/**
 * @route   POST /api/auth/admin/login
 * @desc    Admin login
 * @access  Public
 */
app.post('/api/auth/admin/login', async (req, res) => {
    console.log('👑 Admin login endpoint called');
    console.log('📧 Email received:', req.body.email);
    console.log('🔐 Password received length:', req.body.password?.length);
    
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            console.log('❌ Missing email or password');
            return res.status(400).json({ 
                success: false,
                error: 'Email and password are required' 
            });
        }
        
        console.log('🔍 Querying database for admin with email:', email);
        
        const result = await pool.query(
            'SELECT user_id, full_name, email, role, status, password FROM users WHERE email = $1 AND role = $2',
            [email, 'ADMIN']
        );
        
        console.log('📊 Query result rows count:', result.rows.length);
        
        if (result.rows.length === 0) {
            console.log('❌ No admin found with email:', email);
            return res.status(401).json({ 
                success: false,
                error: 'Invalid admin credentials' 
            });
        }
        
        const admin = result.rows[0];
        console.log('✅ Admin found:', admin.email);
        console.log('🔐 Stored password hash (first 20 chars):', admin.password.substring(0, 20));
        console.log('🔐 Comparing password...');
        
        const validPassword = await bcrypt.compare(password, admin.password);
        console.log('✅ Password valid result:', validPassword);
        
        if (!validPassword) {
            console.log('❌ Invalid password for admin:', email);
            return res.status(401).json({ 
                success: false,
                error: 'Invalid admin credentials' 
            });
        }
        
        if (admin.status !== 'ACTIVE') {
            console.log('❌ Admin account not active:', admin.status);
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
        
        console.log('✅ Admin login successful! Token generated for:', admin.email);
        
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

/**
 * @route   GET /api/auth/admin/users
 * @desc    Get all users (admin only)
 * @access  Private (Admin only)
 */
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
    try {
        await randomForest.trainModel();
        console.log('✅ ML model ready');
    } catch (error) {
        console.error('❌ Failed to train ML model:', error.message);
    }
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
            'GET /api/auth/google',
            'GET /api/auth/google/callback',
            'GET /api/auth/profile',
            'PUT /api/auth/update-profile',
            'POST /api/auth/register-farmer',
            'GET /api/auth/farmer/status',
            'GET /api/auth/farmer/profile'
        ],
        admin: [
            'POST /api/auth/create-first-admin',
            'POST /api/auth/admin/register',
            'POST /api/auth/admin/login',
            'GET /api/auth/admin/users',
            'GET /api/auth/admin/pending-farmers',
            'GET /api/auth/admin/all-farmers',
            'PUT /api/auth/admin/approve-farmer/:farmerId',
            'DELETE /api/auth/admin/reject-farmer/:farmerId'
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
            'GET /health',
            'GET /api/maintenance-status'
        ]
    };
    
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        message: `The requested endpoint ${req.method} ${req.originalUrl} does not exist`,
        available_endpoints: endpoints
    });
});

// ========== START SERVER - FIXED FOR RENDER ==========
// IMPORTANT: Use PORT from environment variable (Render sets this to 10000)
const PORT = process.env.PORT || 3000;

// Bind to 0.0.0.0 to accept connections from outside the container
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 DIGITAL FARMERS MARKET BACKEND SERVER');
    console.log('='.repeat(70));
    console.log(`📡 Server URL:      http://0.0.0.0:${PORT}`);
    console.log(`📊 Health check:    http://0.0.0.0:${PORT}/health`);
    console.log(`🕒 Started at:      ${new Date().toLocaleString()}`);
    console.log(`🔧 Environment:     ${process.env.NODE_ENV || 'development'}`);
    console.log(`💾 Database:        ${process.env.DATABASE_URL ? 'Connected to Render PostgreSQL' : 'Using local database'}`);
    console.log(`🔐 Google OAuth:    ${process.env.GOOGLE_CLIENT_ID ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`🔧 Maintenance API: http://0.0.0.0:${PORT}/api/maintenance-status`);
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