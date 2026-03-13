// controllers/feedbackController.js
const feedbackModel = require('../models/feedbackModel');

const feedbackController = {
    async submitFeedback(req, res) {
        try {
            const userId = req.user.user_id;
            const { productId, orderId, rating, comment } = req.body;
            
            // Validate input
            if (!productId || !orderId || !rating) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Product ID, Order ID, and rating are required' 
                });
            }

            if (rating < 1 || rating > 5) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Rating must be between 1 and 5' 
                });
            }

            // Check if user actually purchased this product
            const purchaseCheck = await feedbackModel.checkUserPurchase(userId, productId, orderId);
            if (!purchaseCheck) {
                return res.status(403).json({ 
                    success: false, 
                    error: 'You can only review products you have purchased' 
                });
            }

            // Check if already reviewed
            const existing = await feedbackModel.getUserProductFeedback(userId, productId, orderId);
            if (existing) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'You have already reviewed this product' 
                });
            }
            
            const feedback = await feedbackModel.submitFeedback(
                userId, productId, orderId, rating, comment
            );
            
            res.json({
                success: true,
                message: 'Feedback submitted successfully',
                feedback
            });
        } catch (error) {
            console.error('Submit feedback error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    async checkFeedback(req, res) {
        try {
            const userId = req.user.user_id;
            const { orderId, productId } = req.params;
            
            const feedback = await feedbackModel.getUserProductFeedback(userId, productId, orderId);
            
            res.json({
                success: true,
                reviewed: !!feedback,
                feedback: feedback || null
            });
        } catch (error) {
            console.error('Check feedback error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    async getProductFeedback(req, res) {
        try {
            const { productId } = req.params;
            const feedback = await feedbackModel.getProductFeedback(productId);
            
            // Get rating statistics
            const stats = await feedbackModel.getProductRatingStats(productId);
            
            res.json({ 
                success: true, 
                feedback,
                stats 
            });
        } catch (error) {
            console.error('Get feedback error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    async getFarmerFeedback(req, res) {
        try {
            const { farmerId } = req.params;
            const feedback = await feedbackModel.getFarmerFeedback(farmerId);
            res.json({ success: true, feedback });
        } catch (error) {
            console.error('Get farmer feedback error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    async updateFeedback(req, res) {
        try {
            const userId = req.user.user_id;
            const { feedbackId } = req.params;
            const { rating, comment } = req.body;
            
            // Check if feedback exists and belongs to user
            const existing = await feedbackModel.getFeedbackById(feedbackId);
            if (!existing) {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Feedback not found' 
                });
            }
            
            if (existing.user_id !== userId) {
                return res.status(403).json({ 
                    success: false, 
                    error: 'You can only update your own feedback' 
                });
            }
            
            const feedback = await feedbackModel.updateFeedback(feedbackId, rating, comment);
            
            res.json({
                success: true,
                message: 'Feedback updated successfully',
                feedback
            });
        } catch (error) {
            console.error('Update feedback error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    async deleteFeedback(req, res) {
        try {
            const userId = req.user.user_id;
            const { feedbackId } = req.params;
            
            // Check if feedback exists and belongs to user
            const existing = await feedbackModel.getFeedbackById(feedbackId);
            if (!existing) {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Feedback not found' 
                });
            }
            
            if (existing.user_id !== userId) {
                return res.status(403).json({ 
                    success: false, 
                    error: 'You can only delete your own feedback' 
                });
            }
            
            await feedbackModel.deleteFeedback(feedbackId);
            
            res.json({
                success: true,
                message: 'Feedback deleted successfully'
            });
        } catch (error) {
            console.error('Delete feedback error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
};

module.exports = feedbackController;