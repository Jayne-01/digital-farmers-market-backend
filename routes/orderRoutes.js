// routes/orderRoutes.js
const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');

// Debug log to check what's imported
console.log('Order controller functions:', Object.keys(orderController));

// POST /api/orders - Create order (requires token)
router.post('/', 
    authenticateToken, 
    orderController.createOrder
);

// GET /api/orders/customer - Get customer orders (requires token)
router.get('/customer', 
    authenticateToken, 
    authorizeRole('CUSTOMER'),
    orderController.getCustomerOrders
);

// GET /api/orders/farmer - Get farmer orders (requires token)
router.get('/farmer', 
    authenticateToken, 
    authorizeRole('FARMER'),
    orderController.getFarmerOrders
);

// GET /api/orders/:id - Get order by ID (requires token)
router.get('/:id', 
    authenticateToken, 
    orderController.getOrderById
);

// GET /api/orders/:id/items - Get order items (requires token)
router.get('/:id/items', 
    authenticateToken, 
    orderController.getOrderItems
);

// PUT /api/orders/:id/status - Update status (requires token)
router.put('/:id/status', 
    authenticateToken, 
    authorizeRole('FARMER'),
    orderController.updateOrderStatus
);

// GET /api/orders/my-purchases - Get orders placed by the logged-in user (any role)
router.get('/my-purchases', 
    authenticateToken,  // no role check – any authenticated user
    orderController.getMyPurchases
);

module.exports = router;