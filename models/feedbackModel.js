// models/feedbackModel.js
const db = require('../config/database');

const feedbackModel = {
    // Check if user purchased this product - FIXED with correct column name
    async checkUserPurchase(userId, productId, orderId) {
        const query = `
            SELECT oi.order_item_id 
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.order_id
            WHERE o.customer_id = $1 AND oi.product_id = $2 AND o.order_id = $3
        `;
        const result = await db.query(query, [userId, productId, orderId]);
        return result.rows.length > 0;
    },

    // Get specific user feedback for a product in an order
    async getUserProductFeedback(userId, productId, orderId) {
        const query = `
            SELECT * FROM feedback
            WHERE user_id = $1 AND product_id = $2 AND order_id = $3
        `;
        const result = await db.query(query, [userId, productId, orderId]);
        return result.rows[0];
    },

    // Get feedback by ID
    async getFeedbackById(feedbackId) {
        const query = 'SELECT * FROM feedback WHERE feedback_id = $1';
        const result = await db.query(query, [feedbackId]);
        return result.rows[0];
    },

    // Create or update feedback
    async submitFeedback(userId, productId, orderId, rating, comment) {
        const query = `
            INSERT INTO feedback (user_id, product_id, order_id, rating, comment, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            ON CONFLICT (user_id, product_id, order_id) 
            DO UPDATE SET rating = $4, comment = $5, updated_at = NOW()
            RETURNING *
        `;
        const result = await db.query(query, [userId, productId, orderId, rating, comment]);
        return result.rows[0];
    },

    // Update existing feedback
    async updateFeedback(feedbackId, rating, comment) {
        const query = `
            UPDATE feedback 
            SET rating = $1, comment = $2, updated_at = NOW()
            WHERE feedback_id = $3
            RETURNING *
        `;
        const result = await db.query(query, [rating, comment, feedbackId]);
        return result.rows[0];
    },

    // Delete feedback
    async deleteFeedback(feedbackId) {
        const query = 'DELETE FROM feedback WHERE feedback_id = $1 RETURNING *';
        const result = await db.query(query, [feedbackId]);
        return result.rows[0];
    },

    // Get feedback for a product with user details
    async getProductFeedback(productId) {
        const query = `
            SELECT f.*, u.full_name as customer_name, u.email
            FROM feedback f
            JOIN users u ON f.user_id = u.user_id
            WHERE f.product_id = $1
            ORDER BY f.created_at DESC
        `;
        const result = await db.query(query, [productId]);
        return result.rows;
    },

    // Get rating statistics for a product
    async getProductRatingStats(productId) {
        const query = `
            SELECT 
                COALESCE(AVG(rating), 0) as average_rating,
                COUNT(*) as review_count,
                COUNT(CASE WHEN rating = 5 THEN 1 END) as five_star,
                COUNT(CASE WHEN rating = 4 THEN 1 END) as four_star,
                COUNT(CASE WHEN rating = 3 THEN 1 END) as three_star,
                COUNT(CASE WHEN rating = 2 THEN 1 END) as two_star,
                COUNT(CASE WHEN rating = 1 THEN 1 END) as one_star
            FROM feedback
            WHERE product_id = $1
        `;
        const result = await db.query(query, [productId]);
        return result.rows[0];
    },

    // Get feedback for a farmer's products
    async getFarmerFeedback(farmerId) {
        const query = `
            SELECT f.*, p.product_name, u.full_name as customer_name, o.order_date
            FROM feedback f
            JOIN products p ON f.product_id = p.product_id
            JOIN users u ON f.user_id = u.user_id
            JOIN orders o ON f.order_id = o.order_id
            WHERE p.farmer_id = $1
            ORDER BY f.created_at DESC
        `;
        const result = await db.query(query, [farmerId]);
        return result.rows;
    },

    // Get average rating for multiple products (for marketplace)
    async getProductsRatingStats(productIds) {
        if (!productIds || productIds.length === 0) return [];
        
        const query = `
            SELECT 
                product_id,
                COALESCE(AVG(rating), 0) as average_rating,
                COUNT(*) as review_count
            FROM feedback
            WHERE product_id = ANY($1::int[])
            GROUP BY product_id
        `;
        const result = await db.query(query, [productIds]);
        return result.rows;
    }
};

module.exports = feedbackModel;