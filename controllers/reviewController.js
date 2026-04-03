// controllers/reviewController.js
const Review = require('../models/reviewModel');
const Product = require('../models/productModel');
const db = require('../config/database');

console.log('✅ Review controller loaded');

// Submit a review (create or update)
const submitReview = async (req, res) => {
    try {
        const { productId } = req.params;
        const { rating, comment } = req.body;
        const userId = req.user.user_id;

        console.log('📝 Submitting review:', { productId, userId, rating, comment });

        // Validate input
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ 
                success: false, 
                error: 'Rating must be between 1 and 5' 
            });
        }

        // Check if product exists
        const productCheck = await db.query(
            'SELECT product_id, product_name FROM products WHERE product_id = $1',
            [productId]
        );

        if (productCheck.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Product not found' 
            });
        }

        // Check if user has already reviewed this product
        const existingReview = await Review.findByProductAndUser(productId, userId);

        let review;
        let isNew = false;

        if (existingReview) {
            // Update existing review
            review = await Review.update(existingReview.review_id, rating, comment);
            console.log('✅ Review updated for product:', productId);
        } else {
            // Create new review
            review = await Review.create(productId, userId, rating, comment);
            isNew = true;
            console.log('✅ New review created for product:', productId);
        }

        // Update product's average rating in the products table (optional - for faster queries)
        const stats = await Review.getProductStats(productId);
        await db.query(
            `UPDATE products 
             SET average_rating = $1, total_reviews = $2 
             WHERE product_id = $3`,
            [stats.average_rating, stats.total_reviews, productId]
        );

        res.json({
            success: true,
            message: isNew ? 'Review submitted successfully' : 'Review updated successfully',
            review: review,
            stats: stats
        });

    } catch (error) {
        console.error('❌ Error submitting review:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error: ' + error.message 
        });
    }
};

// Get reviews for a product
const getProductReviews = async (req, res) => {
    try {
        const { productId } = req.params;
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        console.log('📋 Fetching reviews for product:', productId);

        // Check if product exists
        const productCheck = await db.query(
            'SELECT product_id, product_name FROM products WHERE product_id = $1',
            [productId]
        );

        if (productCheck.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Product not found' 
            });
        }

        // Get reviews with pagination
        const reviewsQuery = `
            SELECT 
                r.*,
                u.full_name as user_name,
                u.avatar as user_avatar
            FROM reviews r
            JOIN users u ON r.user_id = u.user_id
            WHERE r.product_id = $1
            ORDER BY r.created_at DESC
            LIMIT $2 OFFSET $3
        `;
        
        const reviews = await db.query(reviewsQuery, [productId, limit, offset]);
        
        // Get review statistics
        const stats = await Review.getProductStats(productId);
        
        // Get total count for pagination
        const countResult = await db.query(
            'SELECT COUNT(*) FROM reviews WHERE product_id = $1',
            [productId]
        );
        const total = parseInt(countResult.rows[0].count);

        res.json({
            success: true,
            product: {
                id: productId,
                name: productCheck.rows[0].product_name
            },
            reviews: reviews.rows,
            stats: {
                average_rating: parseFloat(stats.average_rating),
                total_reviews: parseInt(stats.total_reviews),
                distribution: {
                    5: parseInt(stats.five_star || 0),
                    4: parseInt(stats.four_star || 0),
                    3: parseInt(stats.three_star || 0),
                    2: parseInt(stats.two_star || 0),
                    1: parseInt(stats.one_star || 0)
                }
            },
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('❌ Error fetching reviews:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
};

// Check if user has reviewed a product
const checkUserReview = async (req, res) => {
    try {
        const { productId } = req.params;
        const userId = req.user.user_id;

        const hasReviewed = await Review.hasUserReviewed(productId, userId);
        
        let userReview = null;
        if (hasReviewed) {
            userReview = await Review.findByProductAndUser(productId, userId);
        }

        res.json({
            success: true,
            hasReviewed,
            review: userReview
        });

    } catch (error) {
        console.error('Error checking user review:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
};

// Delete a review
const deleteReview = async (req, res) => {
    try {
        const { reviewId } = req.params;
        const userId = req.user.user_id;

        // Get the review first to check ownership and get product_id
        const review = await db.query(
            'SELECT * FROM reviews WHERE review_id = $1',
            [reviewId]
        );

        if (review.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Review not found' 
            });
        }

        // Check if user owns this review or is admin
        if (review.rows[0].user_id !== userId && req.user.role !== 'ADMIN') {
            return res.status(403).json({ 
                success: false, 
                error: 'Not authorized to delete this review' 
            });
        }

        const productId = review.rows[0].product_id;
        
        // Delete the review
        await Review.delete(reviewId);

        // Update product's average rating
        const stats = await Review.getProductStats(productId);
        await db.query(
            `UPDATE products 
             SET average_rating = $1, total_reviews = $2 
             WHERE product_id = $3`,
            [stats.average_rating, stats.total_reviews, productId]
        );

        res.json({
            success: true,
            message: 'Review deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting review:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
};

// Get user's review history
const getUserReviews = async (req, res) => {
    try {
        const userId = req.user.user_id;
        
        const reviews = await Review.getUserReviews(userId);

        res.json({
            success: true,
            reviews: reviews
        });

    } catch (error) {
        console.error('Error fetching user reviews:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
};

// Get recent reviews (for admin dashboard)
const getRecentReviews = async (req, res) => {
    try {
        const { limit = 10 } = req.query;
        
        const reviews = await Review.getRecentReviews(limit);

        res.json({
            success: true,
            reviews: reviews
        });

    } catch (error) {
        console.error('Error fetching recent reviews:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
};

module.exports = {
    submitReview,
    getProductReviews,
    checkUserReview,
    deleteReview,
    getUserReviews,
    getRecentReviews
};