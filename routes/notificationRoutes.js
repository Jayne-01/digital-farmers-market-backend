const express = require('express');
const router = express.Router();
const NotificationController = require('../controllers/notificationController');
const { authenticateToken } = require('../middleware/auth'); // your JWT middleware

// All notification routes require authentication
router.use(authenticateToken);

// GET /api/notifications
router.get('/', NotificationController.getNotifications);

// PUT /api/notifications/:id/read
router.put('/:id/read', NotificationController.markAsRead);

// PUT /api/notifications/mark-all-read
router.put('/mark-all-read', NotificationController.markAllAsRead);

module.exports = router;