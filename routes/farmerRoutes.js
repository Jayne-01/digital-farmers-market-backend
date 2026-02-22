const express = require('express');
const router = express.Router();
const farmerController = require('../controllers/farmerController');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');

// Apply authentication middleware to all farmer routes
console.log('Farmer routes loaded - checking role: FARMER');
router.use(authenticateToken);
router.use(authorizeRole('FARMER'));

// GET /api/farmers/dashboard - Get farmer dashboard data
router.get('/dashboard', async (req, res) => {
    try {
        await farmerController.getFarmerDashboard(req, res);
    } catch (error) {
        console.error('Farmer dashboard route error:', error);
        res.status(500).json({ 
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// PUT /api/farmers/profile - Update farmer profile
router.put('/profile', async (req, res) => {
    try {
        //  destructuring
        const { farm_name, barangay, farm_description, product_categories } = req.body;
        
        // Validation 
        if (!farm_name && !barangay && !farm_description && !product_categories) {
            return res.status(400).json({ 
                message: 'At least one field is required for update: farm_name, barangay, farm_description' 
            });
        }

        if (farm_name && farm_name.trim().length < 2) {
            return res.status(400).json({ 
                message: 'Farm name must be at least 2 characters long' 
            });
        }

        await farmerController.updateFarmerProfile(req, res);
    } catch (error) {
        console.error('Update farmer profile route error:', error);
        res.status(500).json({ 
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// GET /api/farmers/sales-report - Get sales report
router.get('/sales-report', async (req, res) => {
    try {
        const { period } = req.query;
        
        // Validate period parameter if provided
        if (period && !['weekly', 'monthly', 'yearly'].includes(period)) {
            return res.status(400).json({ 
                message: 'Invalid period. Must be: weekly, monthly, or yearly' 
            });
        }

        await farmerController.getFarmerSalesReport(req, res);
    } catch (error) {
        console.error('Sales report route error:', error);
        res.status(500).json({ 
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// GET /api/farmers/inventory - Get farmer inventory
router.get('/inventory', async (req, res) => {
    try {
        const { category, status, sortBy, sortOrder } = req.query;
        
        // Validate sortBy parameter if provided
        const validSortFields = ['created_at', 'product_name', 'price', 'updated_at'];
        if (sortBy && !validSortFields.includes(sortBy)) {
            return res.status(400).json({ 
                message: `Invalid sort field. Must be one of: ${validSortFields.join(', ')}` 
            });
        }

        // Validate sortOrder parameter if provided
        if (sortOrder && !['ASC', 'DESC'].includes(sortOrder.toUpperCase())) {
            return res.status(400).json({ 
                message: 'Invalid sort order. Must be: ASC or DESC' 
            });
        }

        await farmerController.getFarmerInventory(req, res);
    } catch (error) {
        console.error('Inventory route error:', error);
        res.status(500).json({ 
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

module.exports = router;