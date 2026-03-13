// models/notificationModel.js
const db = require('../config/database');

const NotificationModel = {
    /**
     * Create a new notification for a customer
     * @param {number} userId - ID of the customer user
     * @param {number} orderId - ID of the related order
     * @param {string} message - Notification message
     * @returns {Promise<object>} The created notification
     */
    async create(userId, orderId, message) {
        const query = `
            INSERT INTO notifications (user_id, order_id, type, message, is_read, created_at)
            VALUES ($1, $2, 'status_update', $3, false, CURRENT_TIMESTAMP)
            RETURNING id, user_id, order_id, type, message, is_read, created_at
        `;
        const values = [userId, orderId, message];
        const result = await db.query(query, values);
        return result.rows[0];
    },

    /**
     * Get notifications for a customer, latest first
     * @param {number} userId - Customer user ID
     * @param {number} limit - Maximum number to return (default 20)
     * @returns {Promise<Array>} List of notifications
     */
    async findByUser(userId, limit = 20) {
        const query = `
            SELECT n.id, n.user_id, n.order_id, n.type, n.message, n.is_read, n.created_at,
                   o.total_amount,
                   o.order_status
            FROM notifications n
            LEFT JOIN orders o ON n.order_id = o.order_id
            WHERE n.user_id = $1
            ORDER BY n.created_at DESC
            LIMIT $2
        `;
        const result = await db.query(query, [userId, limit]);
        return result.rows;
    },

    /**
     * Get unread count for a customer
     * @param {number} userId - Customer user ID
     * @returns {Promise<number>} Number of unread notifications
     */
    async getUnreadCount(userId) {
        const query = `
            SELECT COUNT(*) as count
            FROM notifications
            WHERE user_id = $1 AND is_read = false
        `;
        const result = await db.query(query, [userId]);
        return parseInt(result.rows[0].count);
    },

    /**
     * Mark a notification as read
     * @param {number} notificationId - Notification ID
     * @param {number} userId - Customer user ID (to ensure ownership)
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
     * Mark all notifications for a customer as read
     * @param {number} userId - Customer user ID
     * @returns {Promise<number>} Number of rows updated
     */
    async markAllAsRead(userId) {
        const query = `
            UPDATE notifications
            SET is_read = true
            WHERE user_id = $1 AND is_read = false
            RETURNING id
        `;
        const result = await db.query(query, [userId]);
        return result.rowCount;
    },

    /**
     * Delete a notification
     * @param {number} notificationId - Notification ID
     * @param {number} userId - Customer user ID (to ensure ownership)
     * @returns {Promise<boolean>} True if deleted
     */
    async delete(notificationId, userId) {
        const query = `
            DELETE FROM notifications
            WHERE id = $1 AND user_id = $2
            RETURNING id
        `;
        const result = await db.query(query, [notificationId, userId]);
        return result.rowCount > 0;
    },

    /**
     * Delete all notifications for a customer
     * @param {number} userId - Customer user ID
     * @returns {Promise<number>} Number of rows deleted
     */
    async deleteAllForUser(userId) {
        const query = `
            DELETE FROM notifications
            WHERE user_id = $1
            RETURNING id
        `;
        const result = await db.query(query, [userId]);
        return result.rowCount;
    },

    /**
     * Delete old notifications (cleanup)
     * @param {number} daysOld - Delete notifications older than this many days
     * @returns {Promise<number>} Number of rows deleted
     */
    async deleteOldNotifications(daysOld = 30) {
        const query = `
            DELETE FROM notifications
            WHERE created_at < NOW() - INTERVAL '${daysOld} days'
            RETURNING id
        `;
        const result = await db.query(query);
        return result.rowCount;
    }
};

module.exports = NotificationModel;