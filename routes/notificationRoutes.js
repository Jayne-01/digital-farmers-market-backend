// routes/notificationRoutes.js
const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticateToken } = require('../middleware/authMiddleware');

// All routes require authentication (only customers will have user_id)
router.use(authenticateToken);

// GET /api/notifications - Get user notifications
router.get('/', notificationController.getNotifications);

// GET /api/notifications/unread-count - Get unread count only (for notification badge)
router.get('/unread-count', notificationController.getUnreadCount);

// GET /api/notifications/:id - Get single notification by ID
router.get('/:id', notificationController.getNotificationById);

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read', notificationController.markAsRead);

// PUT /api/notifications/mark-all-read - Mark all as read
router.put('/mark-all-read', notificationController.markAllAsRead);

// DELETE /api/notifications/:id - Delete a notification
router.delete('/:id', notificationController.deleteNotification);

// DELETE /api/notifications/delete-all - Delete all notifications for user
router.delete('/delete-all', notificationController.deleteAllNotifications);

module.exports = router;