// controllers/orderController.js
const db = require('../config/database');

const orderController = {
    // Get farmer's orders - FIXED to handle farmer_id correctly
    async getFarmerOrders(req, res) {
        try {
            console.log('Getting farmer orders...');
            console.log('User object:', req.user);
            
            // Get farmer_id from different possible locations
            let farmerId = null;
            
            // Check different places where farmer_id might be
            if (req.user.farmer_id) {
                farmerId = req.user.farmer_id;
            } else if (req.user.user && req.user.user.farmer_id) {
                farmerId = req.user.user.farmer_id;
            } else if (req.user.user_id) {
                // If we have user_id but no farmer_id, try to get it from database
                console.log('No farmer_id in token, fetching from database for user_id:', req.user.user_id);
                
                // You need to query the farmers table to get farmer_id
                // This depends on your database structure
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
                GROUP BY o.order_id
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
                GROUP BY o.order_id
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
                    o.*,
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
                // For farmers, we need to get their farmer_id
                let farmerId = null;
                if (req.user.farmer_id) {
                    farmerId = req.user.farmer_id;
                } else if (req.user.user && req.user.user.farmer_id) {
                    farmerId = req.user.user.farmer_id;
                } else {
                    // Try to get from database
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
            
            query += ` GROUP BY o.order_id`;
            
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

    // Update order status - Handles stock on cancellation
    async updateOrderStatus(req, res) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { status } = req.body;
            const userId = req.user.user_id;
            const userRole = req.user.role;
            
            // Valid statuses
            const validStatuses = ['PENDING', 'CONFIRMED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid status'
                });
            }
            
            // Get current order status and farmer_id
            const orderQuery = await client.query(
                'SELECT order_status, farmer_id, customer_id FROM orders WHERE order_id = $1',
                [id]
            );
            
            if (orderQuery.rows.length === 0) {
                throw new Error('Order not found');
            }
            
            const order = orderQuery.rows[0];
            const currentStatus = order.order_status;
            
            // Check authorization for farmers
            if (userRole === 'FARMER') {
                // Get farmer_id for this user
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
                // Get order items to restore stock
                const itemsQuery = await client.query(
                    `SELECT oi.product_id, oi.quantity 
                     FROM order_items oi
                     WHERE oi.order_id = $1`,
                    [id]
                );
                
                // Restore stock for each item
                for (const item of itemsQuery.rows) {
                    await client.query(
                        `UPDATE products 
                         SET stock = stock + $1,
                             sold_count = sold_count - $1,
                             updated_at = CURRENT_TIMESTAMP
                         WHERE product_id = $2`,
                        [item.quantity, item.product_id]
                    );
                }
            }
            
            // Update order status
            await client.query(
                `UPDATE orders 
                 SET order_status = $1, updated_at = CURRENT_TIMESTAMP
                 WHERE order_id = $2`,
                [status, id]
            );
            
            await client.query('COMMIT');
            
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

    // Cancel order (customer version) - RESTORES STOCK
    async cancelOrder(req, res) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const userId = req.user.user_id;
            
            // Get order details
            const orderQuery = await client.query(
                'SELECT order_status, customer_id FROM orders WHERE order_id = $1',
                [id]
            );
            
            if (orderQuery.rows.length === 0) {
                throw new Error('Order not found');
            }
            
            const order = orderQuery.rows[0];
            
            // Check if order belongs to customer
            if (order.customer_id !== userId) {
                throw new Error('Not authorized to cancel this order');
            }
            
            // Check if order can be cancelled (only PENDING or CONFIRMED)
            if (!['PENDING', 'CONFIRMED'].includes(order.order_status)) {
                throw new Error(`Cannot cancel order with status: ${order.order_status}`);
            }
            
            // Get order items to restore stock
            const itemsQuery = await client.query(
                `SELECT oi.product_id, oi.quantity 
                 FROM order_items oi
                 WHERE oi.order_id = $1`,
                [id]
            );
            
            // Restore stock for each item
            for (const item of itemsQuery.rows) {
                await client.query(
                    `UPDATE products 
                     SET stock = stock + $1,
                         sold_count = sold_count - $1,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE product_id = $2`,
                    [item.quantity, item.product_id]
                );
            }
            
            // Update order status to CANCELLED
            await client.query(
                `UPDATE orders 
                 SET order_status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
                 WHERE order_id = $1`,
                [id]
            );
            
            await client.query('COMMIT');
            
            res.json({
                success: true,
                message: 'Order cancelled successfully'
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
    }
};

module.exports = orderController;