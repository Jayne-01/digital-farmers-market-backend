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
                p.unit,
                p.image_url,
                p.status AS product_status,
                p.stock,
                p.farmer_id,
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
        
        const product = productCheck.rows[0];
        
        // Check if enough stock
        if (product.stock < quantity) {
            throw new Error(`Only ${product.stock} ${product.unit}${product.stock !== 1 ? 's' : ''} available`);
        }
        
        // Check if already in cart
        const existing = await pool.query(
            'SELECT * FROM cart_items WHERE user_id = $1 AND product_id = $2 AND status = $3',
            [userId, productId, 'ACTIVE']
        );
        
        let result;
        
        if (existing.rows.length > 0) {
            // Check if total quantity would exceed stock
            const newQuantity = existing.rows[0].quantity + quantity;
            if (newQuantity > product.stock) {
                throw new Error(`Cannot add ${quantity} more. Only ${product.stock - existing.rows[0].quantity} ${product.unit}${product.stock - existing.rows[0].quantity !== 1 ? 's' : ''} available`);
            }
            
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
            'SELECT ci.*, p.stock FROM cart_items ci JOIN products p ON ci.product_id = p.product_id WHERE ci.cart_item_id = $1 AND ci.user_id = $2',
            [cartItemId, userId]
        );
        
        if (check.rows.length === 0) {
            throw new Error('Cart item not found');
        }
        
        if (newQuantity < 1) {
            throw new Error('Quantity cannot be less than 1');
        }
        
        // Check if enough stock
        const product = check.rows[0];
        if (newQuantity > product.stock) {
            throw new Error(`Only ${product.stock} available`);
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

    // Checkout - FIXED to use correct farmer_id from products table
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
            
            // Get cart items with product details including farmer_id
            const cartItems = await client.query(`
                SELECT 
                    ci.cart_item_id,
                    ci.product_id,
                    ci.quantity,
                    p.price,
                    p.farmer_id,  -- This is the farmer_id from products table (links to farmers table)
                    p.product_name,
                    p.stock,
                    p.unit
                FROM cart_items ci
                JOIN products p ON ci.product_id = p.product_id
                WHERE ci.user_id = $1 AND ci.status = 'ACTIVE'
            `, [userId]);
            
            if (cartItems.rows.length === 0) {
                throw new Error('Cart is empty');
            }
            
            console.log('Cart items for checkout:', cartItems.rows);
            
            // Check if all products are still available and have enough stock
            for (const item of cartItems.rows) {
                if (item.quantity > item.stock) {
                    throw new Error(`Insufficient stock for ${item.product_name}. Available: ${item.stock} ${item.unit}${item.stock !== 1 ? 's' : ''}, Requested: ${item.quantity}`);
                }
            }
            
            // Calculate subtotal
            const subtotal = cartItems.rows.reduce((sum, item) => 
                sum + (parseFloat(item.price) * item.quantity), 0
            );
            
            // Convert delivery option to match database CHECK constraint
            const delivery_option = orderDetails.delivery_option === 'DELIVERY' ? 'Home Delivery' : 'Pick-Up';
            
            // Group items by farmer (using farmer_id from products table)
            const farmerOrders = {};
            for (const item of cartItems.rows) {
                const farmerId = item.farmer_id; // This comes from products table
                
                if (!farmerOrders[farmerId]) {
                    farmerOrders[farmerId] = {
                        farmer_id: farmerId,
                        items: [],
                        subtotal: 0
                    };
                }
                farmerOrders[farmerId].items.push(item);
                farmerOrders[farmerId].subtotal += parseFloat(item.price) * item.quantity;
            }
            
            console.log('Grouped by farmer:', farmerOrders);
            
            const orders = [];
            
            // Create separate order for each farmer
            for (const farmerId in farmerOrders) {
                const group = farmerOrders[farmerId];
                const farmer_total = group.subtotal;
                
                console.log(`Creating order for farmer_id: ${farmerId} with total: ${farmer_total}`);
                
                // Create order with the correct farmer_id (from products table)
                const orderResult = await client.query(
                    `INSERT INTO orders (
                        customer_id,
                        customer_name,
                        farmer_id,  -- This should be the farmer_id from farmers table, NOT user_id
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
                        userId,                          // customer_id (from users table)
                        customerName,                    // customer_name
                        parseInt(farmerId),              // farmer_id (from farmers table, NOT user_id)
                        farmer_total,                     // total_amount
                        orderDetails.address || null,    // address
                        orderDetails.contact_number || null, // contact_number
                        delivery_option,                  // delivery_option
                        orderDetails.payment_method || 'COD', // payment_method
                        'PENDING'                          // order_status
                    ]
                );
                
                const order_id = orderResult.rows[0].order_id;
                console.log(`Created order ${order_id} for farmer ${farmerId}`);
                
                // Add items for this order and DECREMENT STOCK
                for (const item of group.items) {
                    await client.query(
                        `INSERT INTO order_items (order_id, product_id, quantity, price) 
                         VALUES ($1, $2, $3, $4)`,
                        [order_id, item.product_id, item.quantity, item.price]
                    );
                    
                    // DECREMENT stock and INCREMENT sold_count
                    await client.query(
                        `UPDATE products 
                         SET stock = stock - $1, 
                             sold_count = sold_count + $1,
                             updated_at = CURRENT_TIMESTAMP
                         WHERE product_id = $2`,
                        [item.quantity, item.product_id]
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
            
            console.log('Checkout completed successfully. Orders created:', orders.length);
            
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