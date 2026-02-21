const cartModel = require('../models/cartModel');

const cartController = {
    // Get cart items
    async getCart(req, res) {
        try {
            const userId = req.user.user_id;
            const items = await cartModel.getCart(userId);
            
            res.json({
                success: true,
                items
            });
        } catch (error) {
            console.error('Get cart error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    },

    // Add to cart
    async addToCart(req, res) {
        try {
            const userId = req.user.user_id;
            const { product_id, quantity } = req.body;
            
            if (!product_id) {
                return res.status(400).json({
                    success: false,
                    error: 'Product ID is required'
                });
            }
            
            const cartItem = await cartModel.addToCart(userId, product_id, quantity || 1);
            const cartCount = await cartModel.getCartCount(userId);
            
            res.json({
                success: true,
                message: 'Added to cart successfully',
                cart_item: cartItem,
                cart_count: cartCount
            });
        } catch (error) {
            console.error('Add to cart error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    },

    // Get cart count
    async getCartCount(req, res) {
        try {
            const userId = req.user.user_id;
            const count = await cartModel.getCartCount(userId);
            
            res.json({
                success: true,
                count
            });
        } catch (error) {
            console.error('Cart count error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    },

    // Update cart item
    async updateCartItem(req, res) {
        try {
            const userId = req.user.user_id;
            const { id } = req.params;
            const { quantity, change } = req.body;
            
            let newQuantity;
            
            if (quantity !== undefined) {
                newQuantity = quantity;
            } else if (change !== undefined) {
                // Get current quantity
                const cart = await cartModel.getCart(userId);
                const item = cart.find(i => i.cart_item_id == id);
                
                if (!item) {
                    return res.status(404).json({
                        success: false,
                        error: 'Cart item not found'
                    });
                }
                
                newQuantity = item.quantity + change;
                
                if (newQuantity < 1) {
                    return res.status(400).json({
                        success: false,
                        error: 'Quantity cannot be less than 1'
                    });
                }
            } else {
                return res.status(400).json({
                    success: false,
                    error: 'Quantity or change is required'
                });
            }
            
            const updatedItem = await cartModel.updateCartItem(id, userId, newQuantity);
            const cartCount = await cartModel.getCartCount(userId);
            
            res.json({
                success: true,
                message: 'Cart updated successfully',
                cart_item: updatedItem,
                cart_count: cartCount
            });
        } catch (error) {
            console.error('Update cart error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    },

    // Remove from cart
    async removeFromCart(req, res) {
        try {
            const userId = req.user.user_id;
            const { id } = req.params;
            
            await cartModel.removeFromCart(id, userId);
            const cartCount = await cartModel.getCartCount(userId);
            
            res.json({
                success: true,
                message: 'Item removed from cart',
                cart_count: cartCount
            });
        } catch (error) {
            console.error('Remove from cart error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    },

    // Clear cart
    async clearCart(req, res) {
        try {
            const userId = req.user.user_id;
            
            await cartModel.clearCart(userId);
            
            res.json({
                success: true,
                message: 'Cart cleared successfully',
                cart_count: 0
            });
        } catch (error) {
            console.error('Clear cart error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    },

    // Checkout// In cartController.js
    async checkout(req, res) {
        try {
            const userId = req.user.user_id;
            const { delivery_option, address, contact_number, payment_method } = req.body;
            
            // Validate
            if (!delivery_option) {
                return res.status(400).json({
                    success: false,
                    error: 'Delivery option is required'
                });
            }
            
            if (!address) {
                return res.status(400).json({
                    success: false,
                    error: 'Address is required'
                });
            }
            
            if (!contact_number) {
                return res.status(400).json({
                    success: false,
                    error: 'Contact number is required'
                });
            }
            
            if (!payment_method) {
                return res.status(400).json({
                    success: false,
                    error: 'Payment method is required'
                });
            }
            
            const result = await cartModel.checkout(userId, {
                delivery_option,
                address,
                contact_number,
                payment_method
            });
            
            res.json(result);
            
        } catch (error) {
            console.error('Checkout error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
};

module.exports = cartController;