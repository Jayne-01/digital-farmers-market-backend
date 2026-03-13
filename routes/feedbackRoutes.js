// routes/feedbackRoutes.js
const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/feedbackController');
const { authenticateToken } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(authenticateToken);

// Submit feedback
router.post('/', feedbackController.submitFeedback);

// Check if product is already reviewed for a specific order
router.get('/check/:orderId/:productId', feedbackController.checkFeedback);

// Get feedback for a specific product
router.get('/product/:productId', feedbackController.getProductFeedback);

// Get feedback for farmer's products
router.get('/farmer/:farmerId', feedbackController.getFarmerFeedback);

// Update feedback
router.put('/:feedbackId', feedbackController.updateFeedback);

// Delete feedback
router.delete('/:feedbackId', feedbackController.deleteFeedback);

module.exports = router;