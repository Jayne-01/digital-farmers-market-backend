// models/cartModel.js
const { pool } = require('../config/database');

const cartModel = {
    // Get cart items for a user
    async getCart(userId) {
        const result = await pool.query(`
            SELECT 
                ci.cart_item_id,
                ci.product_id,
                ci.quantity AS cart_quantity,
                ci.created_at,
                p.product_name,
                p.price,
                p.image_url,
                p.status AS product_status,
                f.farmer_id,
                f.farm_name,
                f.barangay
            FROM cart_items ci
            JOIN products p ON ci.product_id = p.product_id
            JOIN farmers f ON p.farmer_id = f.farmer_id
            WHERE ci.user_id = $1 AND ci.status = 'ACTIVE'
            ORDER BY ci.created_at DESC
        `, [userId]);
        
        return result.rows;
    },

    // Add item to cart
    async addToCart(userId, productId, quantity = 1) {
        // Check if product exists and is available
        const productCheck = await pool.query(
            'SELECT * FROM products WHERE product_id = $1 AND status = $2',
            [productId, 'AVAILABLE']
        );
        
        if (productCheck.rows.length === 0) {
            throw new Error('Product not available');
        }
        
        // Check if already in cart
        const existing = await pool.query(
            'SELECT * FROM cart_items WHERE user_id = $1 AND product_id = $2 AND status = $3',
            [userId, productId, 'ACTIVE']
        );
        
        let result;
        
        if (existing.rows.length > 0) {
            // Update quantity
            result = await pool.query(
                `UPDATE cart_items 
                 SET quantity = quantity + $1, updated_at = NOW() 
                 WHERE cart_item_id = $2 
                 RETURNING *`,
                [quantity, existing.rows[0].cart_item_id]
            );
        } else {
            // Insert new
            result = await pool.query(
                `INSERT INTO cart_items (user_id, product_id, quantity, status, created_at) 
                 VALUES ($1, $2, $3, $4, NOW())
                 RETURNING *`,
                [userId, productId, quantity, 'ACTIVE']
            );
        }
        
        return result.rows[0];
    },

    // Get cart count
    async getCartCount(userId) {
        const result = await pool.query(
            'SELECT COALESCE(SUM(quantity), 0) as count FROM cart_items WHERE user_id = $1 AND status = $2',
            [userId, 'ACTIVE']
        );
        
        return parseInt(result.rows[0].count);
    },

    // Update cart item quantity
    async updateCartItem(cartItemId, userId, newQuantity) {
        const check = await pool.query(
            'SELECT * FROM cart_items WHERE cart_item_id = $1 AND user_id = $2',
            [cartItemId, userId]
        );
        
        if (check.rows.length === 0) {
            throw new Error('Cart item not found');
        }
        
        if (newQuantity < 1) {
            throw new Error('Quantity cannot be less than 1');
        }
        
        const result = await pool.query(
            `UPDATE cart_items 
             SET quantity = $1, updated_at = NOW() 
             WHERE cart_item_id = $2 AND user_id = $3
             RETURNING *`,
            [newQuantity, cartItemId, userId]
        );
        
        return result.rows[0];
    },

    // Remove from cart
    async removeFromCart(cartItemId, userId) {
        const result = await pool.query(
            `UPDATE cart_items 
             SET status = 'REMOVED', updated_at = NOW() 
             WHERE cart_item_id = $1 AND user_id = $2
             RETURNING *`,
            [cartItemId, userId]
        );
        
        if (result.rows.length === 0) {
            throw new Error('Cart item not found');
        }
        
        return result.rows[0];
    },

    // Clear cart
    async clearCart(userId) {
        await pool.query(
            `UPDATE cart_items 
             SET status = 'REMOVED', updated_at = NOW() 
             WHERE user_id = $1 AND status = $2`,
            [userId, 'ACTIVE']
        );
        
        return true;
    },

    // Checkout - create order from cart (with customer full name)
    async checkout(userId, orderDetails) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Get user's full name from users table
            const userResult = await client.query(
                'SELECT full_name FROM users WHERE user_id = $1',
                [userId]
            );
            
            if (userResult.rows.length === 0) {
                throw new Error('User not found');
            }
            
            const customerName = userResult.rows[0].full_name;
            
            // Get cart items
            const cartItems = await client.query(`
                SELECT 
                    ci.cart_item_id,
                    ci.product_id,
                    ci.quantity,
                    p.price,
                    p.farmer_id,
                    p.product_name
                FROM cart_items ci
                JOIN products p ON ci.product_id = p.product_id
                WHERE ci.user_id = $1 AND ci.status = 'ACTIVE'
            `, [userId]);
            
            if (cartItems.rows.length === 0) {
                throw new Error('Cart is empty');
            }
            
            // Check if all products are still available
            for (const item of cartItems.rows) {
                const productCheck = await client.query(
                    'SELECT status FROM products WHERE product_id = $1',
                    [item.product_id]
                );
                
                if (productCheck.rows.length === 0 || productCheck.rows[0].status !== 'AVAILABLE') {
                    throw new Error(`Product ID ${item.product_id} is no longer available`);
                }
            }
            
            // Calculate subtotal only (no delivery fee)
            const subtotal = cartItems.rows.reduce((sum, item) => 
                sum + (parseFloat(item.price) * item.quantity), 0
            );
            
            // Convert delivery option to match database CHECK constraint
            const delivery_option = orderDetails.delivery_option === 'DELIVERY' ? 'Home Delivery' : 'Pick-Up';
            
            // Group items by farmer
            const farmerOrders = {};
            for (const item of cartItems.rows) {
                if (!farmerOrders[item.farmer_id]) {
                    farmerOrders[item.farmer_id] = {
                        farmer_id: item.farmer_id,
                        items: [],
                        subtotal: 0
                    };
                }
                farmerOrders[item.farmer_id].items.push(item);
                farmerOrders[item.farmer_id].subtotal += parseFloat(item.price) * item.quantity;
            }
            
            const orders = [];
            
            // Create separate order for each farmer
            for (const farmerId in farmerOrders) {
                const group = farmerOrders[farmerId];
                const farmer_total = group.subtotal;
                
                // FIXED: Added customer_name to the INSERT query
                const orderResult = await client.query(
                    `INSERT INTO orders (
                        customer_id,
                        customer_name,
                        farmer_id,
                        total_amount,
                        address,
                        contact_number,
                        delivery_option,
                        payment_method,
                        order_status,
                        order_date
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
                    RETURNING order_id`,
                    [
                        userId,
                        customerName,
                        parseInt(farmerId),
                        farmer_total,
                        orderDetails.address || null,
                        orderDetails.contact_number || null,
                        delivery_option,
                        orderDetails.payment_method || 'COD',
                        'PENDING'
                    ]
                );
                
                const order_id = orderResult.rows[0].order_id;
                
                // Add items for this order
                for (const item of group.items) {
                    await client.query(
                        `INSERT INTO order_items (order_id, product_id, quantity, price) 
                         VALUES ($1, $2, $3, $4)`,
                        [order_id, item.product_id, item.quantity, item.price]
                    );
                }
                
                orders.push({
                    order_id,
                    farmer_id: parseInt(farmerId),
                    total_amount: farmer_total,
                    customer_name: customerName,
                    items: group.items.map(item => ({
                        product_id: item.product_id,
                        product_name: item.product_name,
                        quantity: item.quantity,
                        price: parseFloat(item.price)
                    }))
                });
            }
            
            // Clear cart
            await client.query(
                `UPDATE cart_items 
                 SET status = 'ORDERED', updated_at = NOW() 
                 WHERE user_id = $1 AND status = 'ACTIVE'`,
                [userId]
            );
            
            await client.query('COMMIT');
            
            return {
                success: true,
                message: `${orders.length} order(s) placed successfully`,
                orders,
                total_amount: orders.reduce((sum, order) => sum + order.total_amount, 0),
                customer: {
                    id: userId,
                    name: customerName,
                    contact: orderDetails.contact_number,
                    address: orderDetails.address
                }
            };
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Checkout error:', error);
            throw error;
        } finally {
            client.release();
        }
    }
};

module.exports = cartModel;