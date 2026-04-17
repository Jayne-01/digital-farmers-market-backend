// controllers/orderController.js
const db = require('../config/database');
const NotificationModel = require('../models/notificationModel');

async function sendOrderStatusNotification(userId, orderId, oldStatus, newStatus, cancelReason = null) {
    try {
        const statusMessages = {
            'PENDING': 'Your order is pending confirmation',
            'CONFIRMED': 'Your order has been confirmed by the farmer',
            'IN_TRANSIT': 'Your order is on the way to you',
            'DELIVERED': 'Your order has been delivered',
            'CANCELLED': cancelReason ? `Your order has been cancelled. Reason: ${cancelReason}` : 'Your order has been cancelled'
        };

        if (oldStatus !== newStatus) {
            const message = statusMessages[newStatus] || `Your order status has been updated to ${newStatus}`;
            await NotificationModel.create(userId, orderId, message);
            console.log(`✅ Notification sent to customer ${userId} for order ${orderId}: ${message}`);
        }
    } catch (error) {
        console.error('❌ Error sending notification:', error);
    }
}

const orderController = {
    async createOrder(req, res) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { items, delivery_option, address, contact_number, payment_method } = req.body;
            const customer_id = req.user.user_id;
            
            if (!items || items.length === 0) {
                throw new Error('No items in order');
            }
            
            const firstProduct = await client.query(
                'SELECT farmer_id FROM products WHERE product_id = $1',
                [items[0].product_id]
            );
            
            if (firstProduct.rows.length === 0) {
                throw new Error('Product not found');
            }
            
            const farmer_id = firstProduct.rows[0].farmer_id;
            
            let total_amount = 0;
            for (const item of items) {
                total_amount += item.price * item.quantity;
            }
            
            const customerResult = await client.query(
                'SELECT full_name FROM users WHERE user_id = $1',
                [customer_id]
            );
            const customer_name = customerResult.rows[0]?.full_name || 'Customer';
            
            const orderResult = await client.query(`
                INSERT INTO orders (
                    customer_id, farmer_id, customer_name, total_amount, address, 
                    contact_number, delivery_option, payment_method, 
                    order_status, order_date
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', CURRENT_TIMESTAMP)
                RETURNING order_id
            `, [customer_id, farmer_id, customer_name, total_amount, address, contact_number, delivery_option, payment_method]);
            
            const order_id = orderResult.rows[0].order_id;
            
            for (const item of items) {
                const productResult = await client.query(
                    'SELECT product_name, image_url, stock FROM products WHERE product_id = $1',
                    [item.product_id]
                );
                
                if (productResult.rows.length === 0) {
                    throw new Error(`Product ${item.product_id} not found`);
                }
                
                const product_name = productResult.rows[0].product_name;
                const product_image = productResult.rows[0].image_url || '';
                const currentStock = productResult.rows[0].stock;
                
                if (currentStock < item.quantity) {
                    throw new Error(`Insufficient stock for ${product_name}. Available: ${currentStock}`);
                }
                
                await client.query(`
                    INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_image_snapshot, quantity, price)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [order_id, item.product_id, product_name, product_image, item.quantity, item.price]);
                
                await client.query(`
                    UPDATE products 
                    SET stock = stock - $1,
                        sold_count = sold_count + $1
                    WHERE product_id = $2
                `, [item.quantity, item.product_id]);
            }
            
            await client.query('COMMIT');
            
            console.log(`✅ Order ${order_id} created with image snapshots`);
            
            res.json({
                success: true,
                message: 'Order created successfully',
                order_id: order_id
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Create order error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        } finally {
            client.release();
        }
    },

    async getFarmerOrders(req, res) {
        try {
            let farmerId = null;
            
            if (req.user.farmer_id) {
                farmerId = req.user.farmer_id;
            } else if (req.user.user_id) {
                const farmerResult = await db.query(
                    'SELECT farmer_id FROM farmers WHERE user_id = $1',
                    [req.user.user_id]
                );
                if (farmerResult.rows.length > 0) {
                    farmerId = farmerResult.rows[0].farmer_id;
                }
            }
            
            if (!farmerId) {
                return res.status(400).json({
                    success: false,
                    error: 'Farmer ID not found.'
                });
            }
            
            const ordersQuery = `
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
                    o.cancel_reason
                FROM orders o
                WHERE o.farmer_id = $1
                ORDER BY o.order_date DESC
            `;
            
            const ordersResult = await db.query(ordersQuery, [farmerId]);
            const ordersWithItems = [];
            
            for (const order of ordersResult.rows) {
                const itemsQuery = `
                    SELECT 
                        oi.order_item_id,
                        oi.product_id,
                        oi.product_name_snapshot,
                        oi.product_image_snapshot,
                        oi.quantity,
                        oi.price,
                        CASE WHEN p.product_id IS NULL THEN true ELSE false END as is_deleted
                    FROM order_items oi
                    LEFT JOIN products p ON oi.product_id = p.product_id
                    WHERE oi.order_id = $1
                    ORDER BY oi.order_item_id ASC
                `;
                
                const itemsResult = await db.query(itemsQuery, [order.order_id]);
                
                const processedItems = itemsResult.rows.map(item => ({
                    product_id: item.product_id,
                    product_name: item.product_name_snapshot || `Product #${item.product_id}`,
                    product_image: item.product_image_snapshot || '',
                    quantity: parseInt(item.quantity) || 0,
                    price: parseFloat(item.price) || 0,
                    is_deleted: item.is_deleted === true
                }));
                
                ordersWithItems.push({
                    order_id: order.order_id,
                    customer_name: order.customer_name,
                    total_amount: parseFloat(order.total_amount) || 0,
                    status: order.status,
                    order_date: order.order_date,
                    address: order.address,
                    contact_number: order.contact_number,
                    delivery_option: order.delivery_option,
                    payment_method: order.payment_method,
                    cancel_reason: order.cancel_reason,
                    items: processedItems
                });
            }
            
            res.json({
                success: true,
                orders: ordersWithItems,
                count: ordersWithItems.length
            });
            
        } catch (error) {
            console.error('Get farmer orders error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    },

    async getCustomerOrders(req, res) {
        try {
            const userId = req.user.user_id;
            
            const ordersQuery = `
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
                    o.cancel_reason
                FROM orders o
                WHERE o.customer_id = $1
                ORDER BY o.order_date DESC
            `;
            
            const ordersResult = await db.query(ordersQuery, [userId]);
            const ordersWithItems = [];
            
            for (const order of ordersResult.rows) {
                const itemsQuery = `
                    SELECT 
                        oi.order_item_id,
                        oi.product_id,
                        oi.product_name_snapshot,
                        oi.product_image_snapshot,
                        oi.quantity,
                        oi.price,
                        CASE WHEN p.product_id IS NULL THEN true ELSE false END as is_deleted
                    FROM order_items oi
                    LEFT JOIN products p ON oi.product_id = p.product_id
                    WHERE oi.order_id = $1
                    ORDER BY oi.order_item_id ASC
                `;
                
                const itemsResult = await db.query(itemsQuery, [order.order_id]);
                
                const processedItems = itemsResult.rows.map(item => ({
                    product_id: item.product_id,
                    product_name: item.product_name_snapshot || `Product #${item.product_id}`,
                    product_image: item.product_image_snapshot || '',
                    quantity: parseInt(item.quantity) || 0,
                    price: parseFloat(item.price) || 0,
                    is_deleted: item.is_deleted === true
                }));
                
                ordersWithItems.push({
                    order_id: order.order_id,
                    customer_name: order.customer_name,
                    total_amount: parseFloat(order.total_amount) || 0,
                    status: order.status,
                    order_date: order.order_date,
                    address: order.address,
                    contact_number: order.contact_number,
                    delivery_option: order.delivery_option,
                    payment_method: order.payment_method,
                    cancel_reason: order.cancel_reason,
                    items: processedItems
                });
            }
            
            res.json({
                success: true,
                orders: ordersWithItems,
                count: ordersWithItems.length
            });
            
        } catch (error) {
            console.error('Get customer orders error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    },

    async getOrderById(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.user_id;
            const userRole = req.user.role;
            
            let orderQuery = `
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
                    o.cancel_reason
                FROM orders o
                WHERE o.order_id = $1
            `;
            
            const orderValues = [id];
            
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
                    orderQuery += ` AND o.farmer_id = $2`;
                    orderValues.push(farmerId);
                }
            } else {
                orderQuery += ` AND o.customer_id = $2`;
                orderValues.push(userId);
            }
            
            const orderResult = await db.query(orderQuery, orderValues);
            
            if (orderResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Order not found'
                });
            }
            
            const order = orderResult.rows[0];
            console.log(`📋 Order ${id} - cancel_reason from DB: "${order.cancel_reason}"`);
            
            const itemsQuery = `
                SELECT 
                    oi.order_item_id,
                    oi.product_id,
                    oi.product_name_snapshot,
                    oi.product_image_snapshot,
                    oi.quantity,
                    oi.price,
                    CASE WHEN p.product_id IS NULL THEN true ELSE false END as is_deleted
                FROM order_items oi
                LEFT JOIN products p ON oi.product_id = p.product_id
                WHERE oi.order_id = $1
                ORDER BY oi.order_item_id ASC
            `;
            
            const itemsResult = await db.query(itemsQuery, [id]);
            
            const processedItems = itemsResult.rows.map(item => ({
                product_id: item.product_id,
                product_name: item.product_name_snapshot || `Product #${item.product_id}`,
                product_image: item.product_image_snapshot || '',
                quantity: parseInt(item.quantity) || 0,
                price: parseFloat(item.price) || 0,
                is_deleted: item.is_deleted === true
            }));
            
            res.json({
                success: true,
                order: {
                    order_id: order.order_id,
                    customer_id: order.customer_id,
                    farmer_id: order.farmer_id,
                    customer_name: order.customer_name,
                    total_amount: parseFloat(order.total_amount) || 0,
                    order_status: order.order_status,
                    order_date: order.order_date,
                    address: order.address,
                    contact_number: order.contact_number,
                    delivery_option: order.delivery_option,
                    payment_method: order.payment_method,
                    cancel_reason: order.cancel_reason,
                    items: processedItems
                }
            });
            
        } catch (error) {
            console.error('Get order by ID error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    },

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
            const customerId = order.customer_id;
            
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
            
            await client.query(
                `UPDATE orders 
                 SET order_status = $1
                 WHERE order_id = $2`,
                [status, id]
            );
            
            await client.query('COMMIT');
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

    async cancelOrder(req, res) {
        const client = await db.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const { id } = req.params;
            const { reason } = req.body;
            const userId = req.user.user_id;
            
            console.log(`📝 Cancelling order ${id} with reason: "${reason}"`);
            
            const orderQuery = await client.query(
                'SELECT order_status, customer_id, farmer_id FROM orders WHERE order_id = $1',
                [id]
            );
            
            if (orderQuery.rows.length === 0) {
                throw new Error('Order not found');
            }
            
            const order = orderQuery.rows[0];
            const currentStatus = order.order_status;
            
            if (order.customer_id !== userId) {
                throw new Error('Not authorized to cancel this order');
            }
            
            if (order.order_status !== 'PENDING') {
                throw new Error(`Cannot cancel order with status: ${order.order_status}. Only PENDING orders can be cancelled.`);
            }
            
            const itemsQuery = await client.query(
                `SELECT oi.product_id, oi.quantity 
                 FROM order_items oi
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
                
                const stockCheck = await client.query(
                    'SELECT stock FROM products WHERE product_id = $1',
                    [item.product_id]
                );
                
                if (stockCheck.rows[0].stock > 0) {
                    await client.query(
                        `UPDATE products 
                         SET status = 'AVAILABLE'
                         WHERE product_id = $1 AND status = 'UNAVAILABLE'`,
                        [item.product_id]
                    );
                }
            }
            
            const cancelReason = reason && reason.trim() !== '' ? reason.trim() : 'Cancelled by customer';
            
            const updateResult = await client.query(
                `UPDATE orders 
                 SET order_status = 'CANCELLED',
                     cancel_reason = $1
                 WHERE order_id = $2
                 RETURNING order_id, order_status, cancel_reason`,
                [cancelReason, id]
            );
            
            console.log(`✅ Cancel result:`, updateResult.rows[0]);
            
            await client.query('COMMIT');
            await sendOrderStatusNotification(userId, id, currentStatus, 'CANCELLED', cancelReason);
            
            res.json({
                success: true,
                message: 'Order cancelled successfully',
                order_id: parseInt(id),
                status: 'CANCELLED',
                cancel_reason: cancelReason
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
            
            const updateQuery = `
                UPDATE orders 
                SET order_status = $1
                WHERE order_id = ANY($2::int[])
                RETURNING order_id, customer_id
            `;
            
            const result = await client.query(updateQuery, [status, orderIds]);
            
            await client.query('COMMIT');
            
            for (const order of orders) {
                if (order.order_status !== status) {
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
    },
    
    async getOrderStats(req, res) {
        try {
            const userId = req.user.user_id;
            const userRole = req.user.role;
            
            let query = '';
            let values = [];
            
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
    }
};

module.exports = orderController;