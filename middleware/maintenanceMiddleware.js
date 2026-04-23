// middleware/maintenanceMiddleware.js
const { pool } = require('../config/database');

// Helper function to check maintenance mode
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
        console.error('Maintenance check error:', error);
        return false;
    }
}

// Middleware to block non-admin API requests during maintenance
async function maintenanceMiddleware(req, res, next) {
    // Skip for maintenance status endpoint and static files
    if (req.path === '/api/maintenance-status' || 
        req.path === '/maintenance.html' ||
        req.path.includes('/css/') ||
        req.path.includes('/js/') ||
        req.path.includes('/images/')) {
        return next();
    }
    
    try {
        const maintenanceMode = await isMaintenanceMode();
        
        if (maintenanceMode) {
            // Check if user is admin (from token)
            const authHeader = req.headers.authorization;
            if (authHeader) {
                const token = authHeader.split(' ')[1];
                try {
                    const jwt = require('jsonwebtoken');
                    const decoded = jwt.verify(token, process.env.JWT_SECRET);
                    const userResult = await pool.query(
                        'SELECT role FROM users WHERE user_id = $1',
                        [decoded.user_id || decoded.id]
                    );
                    if (userResult.rows[0]?.role === 'ADMIN') {
                        return next(); // Admin allowed
                    }
                } catch (e) {
                    // Token invalid, continue to block
                }
            }
            
            // Block non-admin requests
            if (req.headers.accept && req.headers.accept.includes('application/json')) {
                return res.status(503).json({ 
                    success: false, 
                    maintenance: true,
                    error: 'System is under maintenance. Please try again later.',
                    redirect: '/maintenance.html'
                });
            }
            
            // For HTML requests, redirect to maintenance page
            return res.redirect('/maintenance.html');
        }
        
        next();
    } catch (error) {
        console.error('Maintenance middleware error:', error);
        next();
    }
}

module.exports = maintenanceMiddleware;