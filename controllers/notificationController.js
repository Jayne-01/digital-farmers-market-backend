const NotificationModel = require('../models/notificationModel');

const NotificationController = {
    /**
     * GET /api/notifications
     * Retrieve user's notifications
     */
    async getNotifications(req, res) {
        try {
            const userId = req.user.user_id; // from auth middleware
            const limit = req.query.limit ? parseInt(req.query.limit) : 20;

            const notifications = await NotificationModel.findByUser(userId, limit);
            res.json({ success: true, notifications });
        } catch (error) {
            console.error('Error fetching notifications:', error);
            res.status(500).json({ success: false, error: 'Database error' });
        }
    },

    /**
     * PUT /api/notifications/:id/read
     * Mark a single notification as read
     */
    async markAsRead(req, res) {
        try {
            const userId = req.user.user_id;
            const notificationId = parseInt(req.params.id);

            const updated = await NotificationModel.markAsRead(notificationId, userId);
            if (!updated) {
                return res.status(404).json({ success: false, error: 'Notification not found' });
            }

            res.json({ success: true });
        } catch (error) {
            console.error('Error marking notification as read:', error);
            res.status(500).json({ success: false, error: 'Database error' });
        }
    },

    /**
     * PUT /api/notifications/mark-all-read
     * Mark all user's notifications as read
     */
    async markAllAsRead(req, res) {
        try {
            const userId = req.user.user_id;
            const count = await NotificationModel.markAllAsRead(userId);
            res.json({ success: true, count });
        } catch (error) {
            console.error('Error marking all as read:', error);
            res.status(500).json({ success: false, error: 'Database error' });
        }
    }
};

module.exports = NotificationController;