const NotificationModel = require('../models/notificationModel');

const getNotifications = async (req, res) => {
    try {
        const userId = req.user.user_id;
        const limit = req.query.limit ? parseInt(req.query.limit) : 20;
        const notifications = await NotificationModel.findByUser(userId, limit);
        res.json({ success: true, notifications });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
};

const markAsRead = async (req, res) => {
    try {
        const userId = req.user.user_id;
        const notificationId = parseInt(req.params.id);
        const updated = await NotificationModel.markAsRead(notificationId, userId);
        if (!updated) {
            return res.status(404).json({ success: false, error: 'Notification not found' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error marking as read:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
};

const markAllAsRead = async (req, res) => {
    try {
        const userId = req.user.user_id;
        const count = await NotificationModel.markAllAsRead(userId);
        res.json({ success: true, count });
    } catch (error) {
        console.error('Error marking all as read:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
};

module.exports = {
    getNotifications,
    markAsRead,
    markAllAsRead
};