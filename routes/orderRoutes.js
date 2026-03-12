// routes/orderRoutes.js
const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');

// All order routes require authentication
router.use(authenticateToken);

// Get farmer's orders (farmers only)
router.get('/farmer', authorizeRole('FARMER'), orderController.getFarmerOrders);

// Get customer's orders (customers only)
router.get('/my-purchases', orderController.getCustomerOrders);

// Get order by ID (both farmers and customers can view their own orders)
router.get('/:id', orderController.getOrderById);

// Update order status (farmers only)
router.put('/:id/status', authorizeRole('FARMER'), orderController.updateOrderStatus);

// Cancel order (customers only)
router.put('/:id/cancel', orderController.cancelOrder);

module.exports = router;