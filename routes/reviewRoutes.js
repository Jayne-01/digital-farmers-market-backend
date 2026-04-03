// routes/reviewRoutes.js
const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');

console.log('✅ Review routes loaded');

// ===== PUBLIC ROUTES (no authentication needed) =====

// GET /api/reviews/:productId - Get all reviews for a product
router.get('/:productId', async (req, res) => {
    try {
        await reviewController.getProductReviews(req, res);
    } catch (error) {
        console.error('Get product reviews route error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// ===== PROTECTED ROUTES (authentication required) =====

// POST /api/reviews/:productId - Submit a review (requires authentication)
router.post('/:productId', authenticateToken, async (req, res) => {
    try {
        await reviewController.submitReview(req, res);
    } catch (error) {
        console.error('Submit review route error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// GET /api/reviews/check/:productId - Check if user has reviewed (requires authentication)
router.get('/check/:productId', authenticateToken, async (req, res) => {
    try {
        await reviewController.checkUserReview(req, res);
    } catch (error) {
        console.error('Check user review route error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// DELETE /api/reviews/:reviewId - Delete a review (requires authentication)
router.delete('/:reviewId', authenticateToken, async (req, res) => {
    try {
        await reviewController.deleteReview(req, res);
    } catch (error) {
        console.error('Delete review route error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// GET /api/reviews/user/my-reviews - Get current user's reviews (requires authentication)
router.get('/user/my-reviews', authenticateToken, async (req, res) => {
    try {
        await reviewController.getUserReviews(req, res);
    } catch (error) {
        console.error('Get user reviews route error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// ===== ADMIN ONLY ROUTES =====

// GET /api/reviews/admin/recent - Get recent reviews (admin only)
router.get('/admin/recent', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        await reviewController.getRecentReviews(req, res);
    } catch (error) {
        console.error('Get recent reviews route error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

module.exports = router;