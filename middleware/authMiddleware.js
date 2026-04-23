const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

// Helper function to check maintenance mode
const isMaintenanceMode = async () => {
    try {
        const result = await pool.query('SELECT maintenance_mode FROM system_settings LIMIT 1');
        return result.rows[0]?.maintenance_mode === true;
    } catch (error) {
        console.error('Error checking maintenance mode:', error);
        return false;
    }
};

const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Get user from database to check role and status
        const userResult = await pool.query(
            'SELECT user_id, role, status FROM users WHERE user_id = $1',
            [decoded.user_id || decoded.id]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'User no longer exists' });
        }
        
        if (userResult.rows[0].status !== 'ACTIVE') {
            return res.status(403).json({ error: 'Account is deactivated' });
        }
        
        req.user = {
            ...decoded,
            ...userResult.rows[0],
            id: decoded.user_id || decoded.id,
            user_id: decoded.user_id || decoded.id,
            role: userResult.rows[0].role
        };
        
        // ===== MAINTENANCE MODE CHECK =====
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
        
        console.log('✅ User authenticated:', { 
            id: req.user.id, 
            role: req.user.role,
            email: req.user.email 
        });
        
        next();
    } catch (err) {
        if (err.name === 'JsonWebTokenError') {
            return res.status(403).json({ error: 'Invalid token' });
        }
        if (err.name === 'TokenExpiredError') {
            return res.status(403).json({ error: 'Token expired' });
        }
        console.error('Auth error:', err);
        return res.status(500).json({ error: 'Authentication error' });
    }
};

const authorizeRole = (...roles) => {
    return (req, res, next) => {
        console.log('=== AUTHORIZE ROLE CALLED ===');
        console.log('Roles passed:', roles); 
        console.log('User role from JWT:', req.user?.role);
        
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        const userRole = req.user.role;
        
        if (!roles.includes(userRole)) {
            console.log('ROLE MISMATCH!');
            console.log('User has:', userRole);
            console.log('Required:', roles);
            return res.status(403).json({ 
                error: `Access denied. Required roles: ${roles.join(', ')}`,
                yourRole: userRole,
                requiredRoles: roles
            });
        }
        
        console.log('✅ Role check PASSED!');
        next();
    };
};

module.exports = {
    authenticateToken,
    authorizeRole,
    isMaintenanceMode
};