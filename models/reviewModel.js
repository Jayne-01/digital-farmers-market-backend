// models/reviewModel.js
const db = require('../config/database');

const Review = {
    // Create a new review
    async create(productId, userId, rating, comment) {
        const query = `
            INSERT INTO reviews (product_id, user_id, rating, comment, created_at)
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
            RETURNING *
        `;
        const values = [productId, userId, rating, comment];
        const result = await db.query(query, values);
        return result.rows[0];
    },

    // Update an existing review
    async update(reviewId, rating, comment) {
        const query = `
            UPDATE reviews 
            SET rating = $1, comment = $2, updated_at = CURRENT_TIMESTAMP
            WHERE review_id = $3
            RETURNING *
        `;
        const values = [rating, comment, reviewId];
        const result = await db.query(query, values);
        return result.rows[0];
    },

    // Find a review by product and user
    async findByProductAndUser(productId, userId) {
        const query = `
            SELECT * FROM reviews 
            WHERE product_id = $1 AND user_id = $2
        `;
        const values = [productId, userId];
        const result = await db.query(query, values);
        return result.rows[0];
    },

    // Get all reviews for a product
    async getProductReviews(productId) {
        const query = `
            SELECT 
                r.*,
                u.full_name as user_name,
                u.avatar as user_avatar
            FROM reviews r
            JOIN users u ON r.user_id = u.user_id
            WHERE r.product_id = $1
            ORDER BY r.created_at DESC
        `;
        const values = [productId];
        const result = await db.query(query, values);
        return result.rows;
    },

    // Get review statistics for a product
    async getProductStats(productId) {
        const query = `
            SELECT 
                COUNT(*) as total_reviews,
                COALESCE(AVG(rating), 0) as average_rating,
                COUNT(CASE WHEN rating = 5 THEN 1 END) as five_star,
                COUNT(CASE WHEN rating = 4 THEN 1 END) as four_star,
                COUNT(CASE WHEN rating = 3 THEN 1 END) as three_star,
                COUNT(CASE WHEN rating = 2 THEN 1 END) as two_star,
                COUNT(CASE WHEN rating = 1 THEN 1 END) as one_star
            FROM reviews
            WHERE product_id = $1
        `;
        const values = [productId];
        const result = await db.query(query, values);
        return result.rows[0];
    },

    // Check if user has reviewed a product
    async hasUserReviewed(productId, userId) {
        const query = `
            SELECT EXISTS(
                SELECT 1 FROM reviews 
                WHERE product_id = $1 AND user_id = $2
            ) as exists
        `;
        const values = [productId, userId];
        const result = await db.query(query, values);
        return result.rows[0].exists;
    },

    // Delete a review
    async delete(reviewId) {
        const query = 'DELETE FROM reviews WHERE review_id = $1 RETURNING *';
        const values = [reviewId];
        const result = await db.query(query, values);
        return result.rows[0];
    },

    // Get all reviews by a user
    async getUserReviews(userId) {
        const query = `
            SELECT 
                r.*,
                p.product_name,
                p.image_url as product_image
            FROM reviews r
            JOIN products p ON r.product_id = p.product_id
            WHERE r.user_id = $1
            ORDER BY r.created_at DESC
        `;
        const values = [userId];
        const result = await db.query(query, values);
        return result.rows;
    },

    // Get recent reviews (for dashboard)
    async getRecentReviews(limit = 10) {
        const query = `
            SELECT 
                r.*,
                u.full_name as user_name,
                p.product_name,
                p.image_url as product_image
            FROM reviews r
            JOIN users u ON r.user_id = u.user_id
            JOIN products p ON r.product_id = p.product_id
            ORDER BY r.created_at DESC
            LIMIT $1
        `;
        const values = [limit];
        const result = await db.query(query, values);
        return result.rows;
    }
};

module.exports = Review;