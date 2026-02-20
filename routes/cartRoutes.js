// routes/cartRoutes.js
const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cartController');
const { authenticateToken } = require('../middleware/authMiddleware');

// All cart routes require authentication
router.use(authenticateToken);

// Cart routes
router.get('/', cartController.getCart);
router.post('/add', cartController.addToCart);
router.get('/count', cartController.getCartCount);
router.put('/update/:id', cartController.updateCartItem);
router.delete('/remove/:id', cartController.removeFromCart);
router.delete('/clear', cartController.clearCart);
router.post('/checkout', cartController.checkout);

module.exports = router;