const express = require('express');
const router = express.Router();
const farmerController = require('../controllers/farmerController');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');

console.log('✅ Farmer routes loaded');

// ===== PUBLIC ROUTES (no authentication needed) =====
// THESE MUST COME BEFORE THE AUTH MIDDLEWARE
// GET /api/farmers/:farmerId - Get farmer profile by ID (public)
router.get('/:farmerId(\\d+)', async (req, res) => {  // Only match numeric IDs
    console.log('🔥 PUBLIC ROUTE: Get farmer profile for ID:', req.params.farmerId);
    try {
        await farmerController.getFarmerProfile(req, res);
    } catch (error) {
        console.error('Get farmer profile route error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// ===== PROTECTED ROUTES (require farmer role) =====
// Apply authentication middleware to all routes below this line
console.log('Applying authentication to protected farmer routes');
router.use(authenticateToken);
router.use(authorizeRole('FARMER'));

// GET /api/farmers/dashboard - Get farmer dashboard data
router.get('/dashboard', async (req, res) => {
    console.log('🔒 PROTECTED ROUTE: Get farmer dashboard for user:', req.user?.id);
    try {
        await farmerController.getFarmerDashboard(req, res);
    } catch (error) {
        console.error('Farmer dashboard route error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// PUT /api/farmers/profile - Update farmer profile
router.put('/profile', async (req, res) => {
    console.log('🔒 PROTECTED ROUTE: Update farmer profile for user:', req.user?.id);
    try {
        const { farm_name, barangay, farm_description } = req.body;
        
        // Validation 
        if (!farm_name && !barangay && !farm_description) {
            return res.status(400).json({ 
                success: false,
                message: 'At least one field is required for update: farm_name, barangay, farm_description' 
            });
        }

        if (farm_name && farm_name.trim().length < 2) {
            return res.status(400).json({ 
                success: false,
                message: 'Farm name must be at least 2 characters long' 
            });
        }

        await farmerController.updateFarmerProfile(req, res);
    } catch (error) {
        console.error('Update farmer profile route error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// GET /api/farmers/sales-report - Get sales report
router.get('/sales-report', async (req, res) => {
    console.log('🔒 PROTECTED ROUTE: Get sales report for user:', req.user?.id);
    try {
        const { period } = req.query;
        
        // Validate period parameter if provided
        if (period && !['weekly', 'monthly', 'yearly'].includes(period)) {
            return res.status(400).json({ 
                success: false,
                message: 'Invalid period. Must be: weekly, monthly, or yearly' 
            });
        }

        await farmerController.getFarmerSalesReport(req, res);
    } catch (error) {
        console.error('Sales report route error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// GET /api/farmers/inventory - Get farmer inventory
router.get('/inventory', async (req, res) => {
    console.log('🔒 PROTECTED ROUTE: Get farmer inventory for user:', req.user?.id);
    try {
        const { category, status, sortBy, sortOrder } = req.query;
        
        // Validate sortBy parameter if provided
        const validSortFields = ['created_at', 'product_name', 'price', 'updated_at'];
        if (sortBy && !validSortFields.includes(sortBy)) {
            return res.status(400).json({ 
                success: false,
                message: `Invalid sort field. Must be one of: ${validSortFields.join(', ')}` 
            });
        }

        // Validate sortOrder parameter if provided
        if (sortOrder && !['ASC', 'DESC'].includes(sortOrder.toUpperCase())) {
            return res.status(400).json({ 
                success: false,
                message: 'Invalid sort order. Must be: ASC or DESC' 
            });
        }

        await farmerController.getFarmerInventory(req, res);
    } catch (error) {
        console.error('Inventory route error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

module.exports = router;