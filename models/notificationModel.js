const db = require('../db'); 

const NotificationModel = {
    /**
     * Create a new notification
     * @param {number} userId - ID of the user (customer)
     * @param {number} orderId - ID of the related order (optional)
     * @param {string} type - Notification type (e.g., 'status_update')
     * @param {string} message - Notification message
     * @returns {Promise<object>} The created notification
     */
    async create(userId, orderId, type, message) {
        const query = `
            INSERT INTO notifications (user_id, order_id, type, message, is_read, created_at)
            VALUES ($1, $2, $3, $4, false, CURRENT_TIMESTAMP)
            RETURNING id, user_id, order_id, type, message, is_read, created_at
        `;
        const values = [userId, orderId, type, message];
        const result = await db.query(query, values);
        return result.rows[0];
    },

    /**
     * Get notifications for a user, latest first
     * @param {number} userId - User ID
     * @param {number} limit - Maximum number to return (default 20)
     * @returns {Promise<Array>} List of notifications
     */
    async findByUser(userId, limit = 20) {
        const query = `
            SELECT id, user_id, order_id, type, message, is_read, created_at
            FROM notifications
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT $2
        `;
        const result = await db.query(query, [userId, limit]);
        return result.rows;
    },

    /**
     * Mark a notification as read
     * @param {number} notificationId - Notification ID
     * @param {number} userId - User ID (to ensure ownership)
     * @returns {Promise<boolean>} True if updated
     */
    async markAsRead(notificationId, userId) {
        const query = `
            UPDATE notifications
            SET is_read = true
            WHERE id = $1 AND user_id = $2
            RETURNING id
        `;
        const result = await db.query(query, [notificationId, userId]);
        return result.rowCount > 0;
    },

    /**
     * Mark all notifications for a user as read
     * @param {number} userId - User ID
     * @returns {Promise<number>} Number of rows updated
     */
    async markAllAsRead(userId) {
        const query = `
            UPDATE notifications
            SET is_read = true
            WHERE user_id = $1 AND is_read = false
        `;
        const result = await db.query(query, [userId]);
        return result.rowCount;
    }
};

module.exports = NotificationModel;