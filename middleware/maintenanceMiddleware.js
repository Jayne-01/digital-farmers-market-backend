// middleware/maintenanceMiddleware.js
const { pool } = require('../config/database');

// ========== MAINTENANCE MODE MIDDLEWARE ==========
// This middleware blocks non-admin API requests when maintenance mode is ON
async function maintenanceMiddleware(req, res, next) {
    // Skip for admin routes, maintenance status endpoint, AND maintenance.html
    if (req.path.startsWith('/api/admin') || 
        req.path === '/api/maintenance-status' ||
        req.path.startsWith('/admin') ||
        req.path === '/maintenance.html') {
        return next();
    }
    
    try {
        // Check if system_settings table exists
        const tableCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'system_settings'
            );
        `);
        
        if (!tableCheck.rows[0].exists) {
            return next();
        }
        
        const result = await pool.query('SELECT maintenance_mode FROM system_settings LIMIT 1');
        const isMaintenanceMode = result.rows[0]?.maintenance_mode === true;
        
        if (isMaintenanceMode) {
            // Check if request expects JSON
            if (req.headers.accept && req.headers.accept.includes('application/json')) {
                return res.status(503).json({ 
                    success: false, 
                    error: 'Site is under maintenance. Please try again later.',
                    maintenance: true
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

module.exports = maintenanceCheck;