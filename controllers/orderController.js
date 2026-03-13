// controllers/orderController.js
const db = require('../config/database');
const NotificationModel = require('../models/notificationModel');

// Helper function to send order status notifications to customers only
async function sendOrderStatusNotification(userId, orderId, oldStatus, newStatus) {
    try {
        // Define status messages for customers
        const statusMessages = {
            'PENDING': 'Your order is pending confirmation',
            'CONFIRMED': 'Your order has been confirmed by the farmer',
            'IN_TRANSIT': 'Your order is on the way to you',
            'DELIVERED': 'Your order has been delivered',
            'CANCELLED': 'Your order has been cancelled'
        };

        // Only send notification if status actually changed
        if (oldStatus !== newStatus) {
            const message = statusMessages[newStatus] || `Your order status has been updated to ${newStatus}`;
            
            // Create notification using your model
            await NotificationModel.create(
                userId,           // customer user_id
                orderId,          // order_id
                message           // message
            );
            
            console.log(`✅ Notification sent to customer ${userId} for order ${orderId}: ${message}`);
        }
    } catch (error) {
        console.error('❌ Error sending notification:', error);
        // Don't throw error - notification failure shouldn't break the order update
    }
}

const orderController = {
    // Get farmer's orders
    async getFarmerOrders(req, res) {
        try {
            console.log('Getting farmer orders...');
            console.log('User object:', req.user);
            
            let farmerId = null;
            
            if (req.user.farmer_id) {
                farmerId = req.user.farmer_id;
            } else if (req.user.user && req.user.user.farmer_id) {
                farmerId = req.user.user.farmer_id;
            } else if (req.user.user_id) {
                console.log('No farmer_id in token, fetching from database for user_id:', req.user.user_id);
                
                const farmerResult = await db.query(
                    'SELECT farmer_id FROM farmers WHERE user_id = $1',
                    [req.user.user_id]
                );
                
                if (farmerResult.rows.length > 0) {
                    farmerId = farmerResult.rows[0].farmer_id;
                    console.log('Found farmer_id in database:', farmerId);
                }
            }
            
            if (!farmerId) {
                console.error('No farmer_id found for user');
                return res.status(400).json({
                    success: false,
                    error: 'Farmer ID not found. Please ensure you are registered as a farmer.'
                });
            }
            
            console.log('Using farmer_id:', farmerId);
            
            const query = `
                SELECT 
                    o.order_id,
                    o.customer_name,
                    o.total_amount,
                    o.order_status as status,
                    o.order_date,
                    o.address,
                    o.contact_number,
                    o.delivery_option,
                    o.payment_method,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'product_id', oi.product_id,
                                'product_name', p.product_name,
                                'quantity', oi.quantity,
                                'price', oi.price,
                                'image_url', p.image_url,
                                'unit', p.unit
                            ) ORDER BY oi.order_item_id
                        ) FILTER (WHERE oi.product_id IS NOT NULL), 
                        '[]'::json
                    ) as items
                FROM orders o
                LEFT JOIN order_items oi ON o.order_id = oi.order_id
                LEFT JOIN products p ON oi.product_id = p.product_id
                WHERE o.farmer_id = $1
                GROUP BY o.order_id, o.customer_name, o.total_amount, o.order_status, o.order_date, 
                         o.address, o.contact_number, o.delivery_option, o.payment_method
                ORDER BY o.order_date DESC
            `;
            
            const result = await db.query(query, [farmerId]);
            
            console.log(`Found ${result.rows.length} orders for farmer ${farmerId}`);
            
            res.json({
                success: true,
                orders: result.rows,
                count: result.rows.length
            });
            
        } catch (error) {
            console.error('Get farmer orders error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    },

    // Get customer's orders
    async getCustomerOrders(req, res) {
        try {
            const userId = req.user.user_id;
            
            const query = `
                SELECT 
                    o.order_id,
                    o.customer_name,
                    o.total_amount,
                    o.order_status as status,
                    o.order_date,
                    o.address,
                    o.contact_number,
                    o.delivery_option,
                    o.payment_method,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'product_id', oi.product_id,
                                'product_name', p.product_name,
                                'quantity', oi.quantity,
                                'price', oi.price,
                                'image_url', p.image_url,
                                'unit', p.unit
                            ) ORDER BY oi.order_item_id
                        ) FILTER (WHERE oi.product_id IS NOT NULL), 
                        '[]'::json
                    ) as items
                FROM orders o
                LEFT JOIN order_items oi ON o.order_id = oi.order_id
                LEFT JOIN products p ON oi.product_id = p.product_id
                WHERE o.customer_id = $1
                GROUP BY o.order_id, o.customer_name, o.total_amount, o.order_status, o.order_date, 
                         o.address, o.contact_number, o.delivery_option, o.payment_method
                ORDER BY o.order_date DESC
            `;
            
            const result = await db.query(query, [userId]);
            
            res.json({
                success: true,
                orders: result.rows,
                count: result.rows.length
            });
            
        } catch (error) {
            console.error('Get customer orders error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    },

    // Get order by ID
    async getOrderById(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.user_id;
            const userRole = req.user.role;
            
            let query = `
                SELECT 
                    o.order_id,
                    o.customer_id,
                    o.farmer_id,
                    o.customer_name,
                    o.total_amount,
                    o.order_status,
                    o.order_date,
                    o.address,
                    o.contact_number,
                    o.delivery_option,
                    o.payment_method,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'product_id', oi.product_id,
                                'product_name', p.product_name,
                                'quantity', oi.quantity,
                                'price', oi.price,
                                'image_url', p.image_url,
                                'unit', p.unit
                            ) ORDER BY oi.order_item_id
                        ) FILTER (WHERE oi.product_id IS NOT NULL), 
                        '[]'::json
                    ) as items
                FROM orders o
                LEFT JOIN order_items oi ON o.order_id = oi.order_id
                LEFT JOIN products p ON oi.product_id = p.product_id
                WHERE o.order_id = $1
            `;
            
            const values = [id];
            let paramIndex = 2;
            
            // Add role-based filtering
            if (userRole === 'FARMER') {
                let farmerId = null;
                if (req.user.farmer_id) {
                    farmerId = req.user.farmer_id;
                } else {
                    const farmerResult = await db.query(
                        'SELECT farmer_id FROM farmers WHERE user_id = $1',
                        [userId]
                    );
                    if (farmerResult.rows.length > 0) {
                        farmerId = farmerResult.rows[0].farmer_id;
                    }
                }
                
                if (farmerId) {
                    query += ` AND o.farmer_id = $${paramIndex}`;
                    values.push(farmerId);
                    paramIndex++;
                }
            } else {
                query += ` AND o.customer_id = $${paramIndex}`;
                values.push(userId);
                paramIndex++;
            }
            
            query += ` GROUP BY o.order_id, o.customer_id, o.farmer_id, o.customer_name, o.total_amount, 
                              o.order_status, o.order_date, o.address, o.contact_number, 
                              o.delivery_option, o.payment_method`;
            
            const result = await db.query(query, values);
            
            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Order not found'
                });
            }
            
            res.json({
                success: true,
                order: result.rows[0]
            });
            
        } catch (error) {
            console.error('Get order by ID error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    },

    // Update order status (for farmers) - UPDATED WITH NOTIFICATIONS
    async updateOrderStatus(req, res) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { status } = req.body;
            const userId = req.user.user_id;
            const userRole = req.user.role;
            
            const validStatuses = ['PENDING', 'CONFIRMED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid status'
                });
            }
            
            // Get order details with customer_id and current status
            const orderQuery = await client.query(
                'SELECT order_status, farmer_id, customer_id FROM orders WHERE order_id = $1',
                [id]
            );
            
            if (orderQuery.rows.length === 0) {
                throw new Error('Order not found');
            }
            
            const order = orderQuery.rows[0];
            const currentStatus = order.order_status;
            const customerId = order.customer_id;
            
            // Check authorization for farmers
            if (userRole === 'FARMER') {
                let farmerId = null;
                if (req.user.farmer_id) {
                    farmerId = req.user.farmer_id;
                } else {
                    const farmerResult = await client.query(
                        'SELECT farmer_id FROM farmers WHERE user_id = $1',
                        [userId]
                    );
                    if (farmerResult.rows.length > 0) {
                        farmerId = farmerResult.rows[0].farmer_id;
                    }
                }
                
                if (!farmerId || order.farmer_id !== farmerId) {
                    throw new Error('Not authorized to update this order');
                }
            }
            
            // If cancelling an order that wasn't cancelled before, RESTORE STOCK
            if (status === 'CANCELLED' && currentStatus !== 'CANCELLED') {
                const itemsQuery = await client.query(
                    `SELECT oi.product_id, oi.quantity, p.product_name 
                     FROM order_items oi
                     JOIN products p ON oi.product_id = p.product_id
                     WHERE oi.order_id = $1`,
                    [id]
                );
                
                for (const item of itemsQuery.rows) {
                    // Restore stock
                    await client.query(
                        `UPDATE products 
                         SET stock = stock + $1,
                             sold_count = sold_count - $1
                         WHERE product_id = $2`,
                        [item.quantity, item.product_id]
                    );
                    
                    // Check if product should be AVAILABLE again
                    const stockCheck = await client.query(
                        'SELECT stock FROM products WHERE product_id = $1',
                        [item.product_id]
                    );
                    
                    const newStock = stockCheck.rows[0].stock;
                    
                    if (newStock > 0) {
                        await client.query(
                            `UPDATE products 
                             SET status = 'AVAILABLE'
                             WHERE product_id = $1 AND status = 'UNAVAILABLE'`,
                            [item.product_id]
                        );
                        console.log(`✅ Product ${item.product_id} (${item.product_name}) is now back in stock - status set to AVAILABLE`);
                    }
                }
            }
            
            // Update order status
            await client.query(
                `UPDATE orders 
                 SET order_status = $1
                 WHERE order_id = $2`,
                [status, id]
            );
            
            await client.query('COMMIT');
            
            // Send notification to customer about status change
            await sendOrderStatusNotification(customerId, id, currentStatus, status);
            
            res.json({
                success: true,
                message: `Order status updated to ${status}`
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Update order status error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        } finally {
            client.release();
        }
    },

    // Cancel order (for customers) - UPDATED WITH NOTIFICATIONS
    async cancelOrder(req, res) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { reason } = req.body; // Optional cancellation reason
            const userId = req.user.user_id;
            
            console.log(`Customer ${userId} attempting to cancel order ${id}`);
            
            // Get order details
            const orderQuery = await client.query(
                'SELECT order_status, customer_id, farmer_id, total_amount FROM orders WHERE order_id = $1',
                [id]
            );
            
            if (orderQuery.rows.length === 0) {
                throw new Error('Order not found');
            }
            
            const order = orderQuery.rows[0];
            const currentStatus = order.order_status;
            
            // Check if order belongs to this customer
            if (order.customer_id !== userId) {
                throw new Error('Not authorized to cancel this order');
            }
            
            // UPDATED: Only allow cancellation if order status is PENDING
            if (order.order_status !== 'PENDING') {
                throw new Error(`Cannot cancel order with status: ${order.order_status}. Only PENDING orders can be cancelled.`);
            }
            
            // Get order items to restore stock
            const itemsQuery = await client.query(
                `SELECT oi.product_id, oi.quantity, p.product_name 
                 FROM order_items oi
                 JOIN products p ON oi.product_id = p.product_id
                 WHERE oi.order_id = $1`,
                [id]
            );
            
            // Restore stock for each item
            for (const item of itemsQuery.rows) {
                // Restore stock
                await client.query(
                    `UPDATE products 
                     SET stock = stock + $1,
                         sold_count = sold_count - $1
                     WHERE product_id = $2`,
                    [item.quantity, item.product_id]
                );
                
                // Check if product should be AVAILABLE again
                const stockCheck = await client.query(
                    'SELECT stock FROM products WHERE product_id = $1',
                    [item.product_id]
                );
                
                const newStock = stockCheck.rows[0].stock;
                
                if (newStock > 0) {
                    await client.query(
                        `UPDATE products 
                         SET status = 'AVAILABLE'
                         WHERE product_id = $1 AND status = 'UNAVAILABLE'`,
                        [item.product_id]
                    );
                    console.log(`✅ Product ${item.product_id} (${item.product_name}) is now back in stock - status set to AVAILABLE`);
                }
            }
            
            // Update order status to CANCELLED
            await client.query(
                `UPDATE orders 
                 SET order_status = 'CANCELLED'
                 WHERE order_id = $1`,
                [id]
            );
            
            await client.query('COMMIT');
            
            // Send notification about cancellation (to the same user)
            await sendOrderStatusNotification(userId, id, currentStatus, 'CANCELLED');
            
            console.log(`✅ Order ${id} cancelled successfully by customer ${userId}`);
            if (reason) {
                console.log(`   Cancellation reason: ${reason}`);
            }
            
            res.json({
                success: true,
                message: 'Order cancelled successfully',
                order_id: parseInt(id),
                status: 'CANCELLED'
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Cancel order error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        } finally {
            client.release();
        }
    },

    // Get order statistics for dashboard
    async getOrderStats(req, res) {
        try {
            const userId = req.user.user_id;
            const userRole = req.user.role;
            
            let query = '';
            let values = [];
            
            if (userRole === 'FARMER') {
                // Get farmer_id
                let farmerId = null;
                if (req.user.farmer_id) {
                    farmerId = req.user.farmer_id;
                } else {
                    const farmerResult = await db.query(
                        'SELECT farmer_id FROM farmers WHERE user_id = $1',
                        [userId]
                    );
                    if (farmerResult.rows.length > 0) {
                        farmerId = farmerResult.rows[0].farmer_id;
                    }
                }
                
                if (!farmerId) {
                    return res.status(400).json({
                        success: false,
                        error: 'Farmer ID not found'
                    });
                }
                
                query = `
                    SELECT 
                        COUNT(*) as total_orders,
                        COUNT(CASE WHEN order_status = 'PENDING' THEN 1 END) as pending_count,
                        COUNT(CASE WHEN order_status = 'CONFIRMED' THEN 1 END) as confirmed_count,
                        COUNT(CASE WHEN order_status = 'IN_TRANSIT' THEN 1 END) as in_transit_count,
                        COUNT(CASE WHEN order_status = 'DELIVERED' THEN 1 END) as delivered_count,
                        COUNT(CASE WHEN order_status = 'CANCELLED' THEN 1 END) as cancelled_count,
                        COALESCE(SUM(CASE WHEN order_status = 'DELIVERED' THEN total_amount ELSE 0 END), 0) as total_revenue
                    FROM orders
                    WHERE farmer_id = $1
                `;
                values = [farmerId];
                
            } else {
                query = `
                    SELECT 
                        COUNT(*) as total_orders,
                        COUNT(CASE WHEN order_status = 'PENDING' THEN 1 END) as pending_count,
                        COUNT(CASE WHEN order_status = 'CONFIRMED' THEN 1 END) as confirmed_count,
                        COUNT(CASE WHEN order_status = 'IN_TRANSIT' THEN 1 END) as in_transit_count,
                        COUNT(CASE WHEN order_status = 'DELIVERED' THEN 1 END) as delivered_count,
                        COUNT(CASE WHEN order_status = 'CANCELLED' THEN 1 END) as cancelled_count,
                        COALESCE(SUM(CASE WHEN order_status = 'DELIVERED' THEN total_amount ELSE 0 END), 0) as total_spent
                    FROM orders
                    WHERE customer_id = $1
                `;
                values = [userId];
            }
            
            const result = await db.query(query, values);
            
            res.json({
                success: true,
                stats: result.rows[0]
            });
            
        } catch (error) {
            console.error('Get order stats error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    },

    // Optional: Bulk update order status (for farmers)
    async bulkUpdateOrderStatus(req, res) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { orderIds, status } = req.body;
            const userId = req.user.user_id;
            
            if (!orderIds || !orderIds.length || !status) {
                return res.status(400).json({
                    success: false,
                    error: 'Order IDs and status are required'
                });
            }
            
            const validStatuses = ['PENDING', 'CONFIRMED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid status'
                });
            }
            
            // Get farmer_id
            let farmerId = null;
            if (req.user.farmer_id) {
                farmerId = req.user.farmer_id;
            } else {
                const farmerResult = await client.query(
                    'SELECT farmer_id FROM farmers WHERE user_id = $1',
                    [userId]
                );
                if (farmerResult.rows.length > 0) {
                    farmerId = farmerResult.rows[0].farmer_id;
                }
            }
            
            if (!farmerId) {
                throw new Error('Farmer ID not found');
            }
            
            // Get all orders with their current status and customer_ids
            const getOrdersQuery = `
                SELECT order_id, order_status, customer_id
                FROM orders
                WHERE order_id = ANY($1::int[]) AND farmer_id = $2
            `;
            
            const ordersResult = await client.query(getOrdersQuery, [orderIds, farmerId]);
            const orders = ordersResult.rows;
            
            if (orders.length === 0) {
                throw new Error('No valid orders found');
            }
            
            // Update all orders
            const updateQuery = `
                UPDATE orders 
                SET order_status = $1
                WHERE order_id = ANY($2::int[])
                RETURNING order_id, customer_id
            `;
            
            const result = await client.query(updateQuery, [status, orderIds]);
            
            await client.query('COMMIT');
            
            // Send notifications for each updated order
            for (const order of orders) {
                if (order.order_status !== status) { // Only if status changed
                    await sendOrderStatusNotification(order.customer_id, order.order_id, order.order_status, status);
                }
            }
            
            res.json({
                success: true,
                message: `${result.rowCount} orders updated successfully`,
                orders: result.rows
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Bulk update order status error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        } finally {
            client.release();
        }
    }
};

module.exports = orderController;