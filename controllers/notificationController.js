// controllers/notificationController.js
const NotificationModel = require('../models/notificationModel');

const notificationController = {
    // Get notifications for the authenticated customer
    async getNotifications(req, res) {
        try {
            const userId = req.user.user_id;
            const limit = req.query.limit ? parseInt(req.query.limit) : 20;
            
            const notifications = await NotificationModel.findByUser(userId, limit);
            const unreadCount = await NotificationModel.getUnreadCount(userId);
            
            res.json({ 
                success: true, 
                notifications,
                unreadCount
            });
        } catch (error) {
            console.error('Error fetching notifications:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Database error' 
            });
        }
    },

    // Get unread count only (for notification badge)
    async getUnreadCount(req, res) {
        try {
            const userId = req.user.user_id;
            const count = await NotificationModel.getUnreadCount(userId);
            
            res.json({ 
                success: true, 
                count 
            });
        } catch (error) {
            console.error('Error getting unread count:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Database error' 
            });
        }
    },

    // Mark a notification as read
    async markAsRead(req, res) {
        try {
            const userId = req.user.user_id;
            const notificationId = parseInt(req.params.id);
            
            const updated = await NotificationModel.markAsRead(notificationId, userId);
            
            if (!updated) {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Notification not found' 
                });
            }
            
            // Get updated unread count
            const unreadCount = await NotificationModel.getUnreadCount(userId);
            
            res.json({ 
                success: true,
                unreadCount
            });
        } catch (error) {
            console.error('Error marking as read:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Database error' 
            });
        }
    },

    // Mark all notifications as read
    async markAllAsRead(req, res) {
        try {
            const userId = req.user.user_id;
            const count = await NotificationModel.markAllAsRead(userId);
            
            res.json({ 
                success: true, 
                count,
                message: `${count} notification(s) marked as read`
            });
        } catch (error) {
            console.error('Error marking all as read:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Database error' 
            });
        }
    },

    // Delete a notification
    async deleteNotification(req, res) {
        try {
            const userId = req.user.user_id;
            const notificationId = parseInt(req.params.id);
            
            const deleted = await NotificationModel.delete(notificationId, userId);
            
            if (!deleted) {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Notification not found' 
                });
            }
            
            // Get updated unread count
            const unreadCount = await NotificationModel.getUnreadCount(userId);
            
            res.json({ 
                success: true,
                message: 'Notification deleted successfully',
                unreadCount
            });
        } catch (error) {
            console.error('Error deleting notification:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Database error' 
            });
        }
    },

    // Delete all notifications for the user
    async deleteAllNotifications(req, res) {
        try {
            const userId = req.user.user_id;
            const count = await NotificationModel.deleteAllForUser(userId);
            
            res.json({ 
                success: true, 
                count,
                message: `${count} notification(s) deleted`
            });
        } catch (error) {
            console.error('Error deleting all notifications:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Database error' 
            });
        }
    },

    // Get a single notification by ID
    async getNotificationById(req, res) {
        try {
            const notificationId = parseInt(req.params.id);
            const userId = req.user.user_id;
            
            // Direct query to check ownership
            const query = `
                SELECT * FROM notifications
                WHERE id = $1 AND user_id = $2
            `;
            const result = await db.query(query, [notificationId, userId]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Notification not found' 
                });
            }
            
            res.json({ 
                success: true, 
                notification: result.rows[0] 
            });
        } catch (error) {
            console.error('Error fetching notification:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Database error' 
            });
        }
    }
};

module.exports = notificationController;