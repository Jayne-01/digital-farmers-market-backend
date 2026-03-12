// controllers/orderController.js
const db = require('../config/database');

const orderController = {
    // Get farmer's orders - FIXED for your database structure
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
            
            // FIXED: Removed references to created_at and updated_at
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

    // Get customer's orders - FIXED for your database structure
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

    // Get order by ID - FIXED for your database structure
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

    // Update order status - FIXED for your database structure
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
            
            const orderQuery = await client.query(
                'SELECT order_status, farmer_id, customer_id FROM orders WHERE order_id = $1',
                [id]
            );
            
            if (orderQuery.rows.length === 0) {
                throw new Error('Order not found');
            }
            
            const order = orderQuery.rows[0];
            const currentStatus = order.order_status;
            
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
            
            // FIXED: Using only columns that exist in your database
            await client.query(
                `UPDATE orders 
                 SET order_status = $1
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

    // Cancel order (customer version) - FIXED for your database structure
    async cancelOrder(req, res) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const userId = req.user.user_id;
            
            const orderQuery = await client.query(
                'SELECT order_status, customer_id FROM orders WHERE order_id = $1',
                [id]
            );
            
            if (orderQuery.rows.length === 0) {
                throw new Error('Order not found');
            }
            
            const order = orderQuery.rows[0];
            
            if (order.customer_id !== userId) {
                throw new Error('Not authorized to cancel this order');
            }
            
            if (!['PENDING', 'CONFIRMED'].includes(order.order_status)) {
                throw new Error(`Cannot cancel order with status: ${order.order_status}`);
            }
            
            const itemsQuery = await client.query(
                `SELECT oi.product_id, oi.quantity, p.product_name 
                 FROM order_items oi
                 JOIN products p ON oi.product_id = p.product_id
                 WHERE oi.order_id = $1`,
                [id]
            );
            
            for (const item of itemsQuery.rows) {
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
            
            // FIXED: Using only columns that exist in your database
            await client.query(
                `UPDATE orders 
                 SET order_status = 'CANCELLED'
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