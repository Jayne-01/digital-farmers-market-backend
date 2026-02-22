// controllers/orderController.js
const db = require('../config/database');
const Farmer = require('../models/farmerModel');

// POST /api/orders - Create order
const createOrder = async (req, res) => {
    try {
        // Implementation for creating order
        // This should move items from cart to orders
        res.json({ 
            success: true, 
            message: 'Create order endpoint' 
        });
    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
};

// GET /api/orders/customer - Get customer orders
const getCustomerOrders = async (req, res) => {
    try {
        const customer_id = req.user.user_id;
        
        const query = `
            SELECT 
                o.order_id,
                o.customer_id,
                o.farmer_id,
                o.total_amount,
                o.order_status as status,
                o.payment_method,
                o.delivery_option,
                o.address,
                o.contact_number,
                o.order_date,
                f.farm_name,
                (
                    SELECT json_agg(
                        json_build_object(
                            'order_item_id', oi.order_item_id,
                            'product_id', oi.product_id,
                            'product_name', p.product_name,
                            'quantity', oi.quantity,
                            'price', oi.price,
                            'image_url', p.image_url
                        )
                    )
                    FROM order_items oi
                    JOIN products p ON oi.product_id = p.product_id
                    WHERE oi.order_id = o.order_id
                ) as items
            FROM orders o
            LEFT JOIN farmers f ON o.farmer_id = f.farmer_id
            WHERE o.customer_id = $1
            ORDER BY o.order_date DESC
        `;

        const result = await db.query(query, [customer_id]);
        
        // Transform the data for frontend
        const orders = result.rows.map(order => ({
            ...order,
            delivery_address: order.address,
            items: order.items || [] // Ensure items is always an array
        }));
        
        res.json({
            success: true,
            orders: orders
        });

    } catch (error) {
        console.error('Get customer orders error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error',
            details: error.message 
        });
    }
};

// GET /api/orders/farmer - Get farmer orders (ONLY orders containing this farmer's products)
const getFarmerOrders = async (req, res) => {
    try {
        console.log('Getting orders for farmer user ID:', req.user.user_id);
        
        // Get farmer_id from the authenticated user
        const farmerResult = await Farmer.findByUserId(req.user.user_id);
        
        if (farmerResult.rows.length === 0) {
            return res.status(403).json({ 
                success: false, 
                error: 'User is not a registered farmer' 
            });
        }

        const farmer_id = farmerResult.rows[0].farmer_id;
        console.log('Farmer ID:', farmer_id);

        // SIMPLIFIED QUERY - First get all orders that contain this farmer's products
        const ordersQuery = `
            SELECT DISTINCT 
                o.order_id,
                o.customer_id,
                o.farmer_id,
                o.total_amount,
                o.order_status as status,
                o.payment_method,
                o.delivery_option,
                o.address,
                o.contact_number,
                o.order_date,
                u.full_name as customer_name,
                u.email as customer_email,
                u.contact_number as customer_contact
            FROM orders o
            JOIN users u ON o.customer_id = u.user_id
            WHERE EXISTS (
                SELECT 1
                FROM order_items oi
                JOIN products p ON oi.product_id = p.product_id
                WHERE oi.order_id = o.order_id AND p.farmer_id = $1
            )
            ORDER BY o.order_date DESC
        `;

        console.log('Executing orders query...');
        const ordersResult = await db.query(ordersQuery, [farmer_id]);
        
        console.log(`Found ${ordersResult.rows.length} orders for farmer ${farmer_id}`);
        
        // For each order, get only the items belonging to this farmer
        const orders = [];
        
        for (const order of ordersResult.rows) {
            const itemsQuery = `
                SELECT 
                    oi.order_item_id,
                    oi.order_id,
                    oi.product_id,
                    oi.quantity,
                    oi.price,
                    p.product_name,
                    p.image_url,
                    p.category
                FROM order_items oi
                JOIN products p ON oi.product_id = p.product_id
                WHERE oi.order_id = $1 AND p.farmer_id = $2
            `;
            
            const itemsResult = await db.query(itemsQuery, [order.order_id, farmer_id]);
            
            orders.push({
                order_id: order.order_id,
                customer_id: order.customer_id,
                farmer_id: order.farmer_id,
                total_amount: parseFloat(order.total_amount),
                status: order.status,
                payment_method: order.payment_method,
                delivery_option: order.delivery_option,
                address: order.address,
                delivery_address: order.address,
                contact_number: order.contact_number,
                order_date: order.order_date,
                customer_name: order.customer_name,
                customer_email: order.customer_email,
                customer_contact: order.customer_contact,
                items: itemsResult.rows || []
            });
        }
        
        res.json({
            success: true,
            orders: orders,
            count: orders.length
        });

    } catch (error) {
        console.error('Get farmer orders error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error',
            details: error.message 
        });
    }
};

// GET /api/orders/:id - Get order by ID
const getOrderById = async (req, res) => {
    try {
        const { id } = req.params;
        
        let query;
        let values;
        
        if (req.user.role === 'FARMER') {
            const farmerResult = await Farmer.findByUserId(req.user.user_id);
            if (farmerResult.rows.length === 0) {
                return res.status(403).json({ 
                    success: false, 
                    error: 'User is not a registered farmer' 
                });
            }
            const farmer_id = farmerResult.rows[0].farmer_id;
            
            // Get order if it contains farmer's products
            query = `
                SELECT 
                    o.order_id,
                    o.customer_id,
                    o.farmer_id,
                    o.total_amount,
                    o.order_status as status,
                    o.payment_method,
                    o.delivery_option,
                    o.address,
                    o.contact_number,
                    o.order_date,
                    u.full_name as customer_name,
                    u.email as customer_email,
                    u.contact_number as customer_contact,
                    f.farm_name
                FROM orders o
                JOIN users u ON o.customer_id = u.user_id
                LEFT JOIN farmers f ON o.farmer_id = f.farmer_id
                WHERE o.order_id = $1 AND EXISTS (
                    SELECT 1
                    FROM order_items oi
                    JOIN products p ON oi.product_id = p.product_id
                    WHERE oi.order_id = o.order_id AND p.farmer_id = $2
                )
            `;
            values = [id, farmer_id];
        } else {
            query = `
                SELECT 
                    o.order_id,
                    o.customer_id,
                    o.farmer_id,
                    o.total_amount,
                    o.order_status as status,
                    o.payment_method,
                    o.delivery_option,
                    o.address,
                    o.contact_number,
                    o.order_date,
                    u.full_name as customer_name,
                    u.email as customer_email,
                    u.contact_number as customer_contact,
                    f.farm_name
                FROM orders o
                JOIN users u ON o.customer_id = u.user_id
                LEFT JOIN farmers f ON o.farmer_id = f.farmer_id
                WHERE o.order_id = $1 AND o.customer_id = $2
            `;
            values = [id, req.user.user_id];
        }

        const result = await db.query(query, values);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Order not found' 
            });
        }

        // Get items for this order
        let itemsQuery;
        let itemsValues;
        
        if (req.user.role === 'FARMER') {
            const farmerResult = await Farmer.findByUserId(req.user.user_id);
            const farmer_id = farmerResult.rows[0].farmer_id;
            
            itemsQuery = `
                SELECT 
                    oi.order_item_id,
                    oi.order_id,
                    oi.product_id,
                    oi.quantity,
                    oi.price,
                    p.product_name,
                    p.image_url,
                    p.category
                FROM order_items oi
                JOIN products p ON oi.product_id = p.product_id
                WHERE oi.order_id = $1 AND p.farmer_id = $2
            `;
            itemsValues = [id, farmer_id];
        } else {
            itemsQuery = `
                SELECT 
                    oi.order_item_id,
                    oi.order_id,
                    oi.product_id,
                    oi.quantity,
                    oi.price,
                    p.product_name,
                    p.image_url,
                    p.category
                FROM order_items oi
                JOIN products p ON oi.product_id = p.product_id
                WHERE oi.order_id = $1
            `;
            itemsValues = [id];
        }
        
        const itemsResult = await db.query(itemsQuery, itemsValues);

        // Transform the data for frontend
        const order = {
            ...result.rows[0],
            total_amount: parseFloat(result.rows[0].total_amount),
            delivery_address: result.rows[0].address,
            items: itemsResult.rows || []
        };

        res.json({
            success: true,
            order: order
        });

    } catch (error) {
        console.error('Get order by ID error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error',
            details: error.message 
        });
    }
};

// GET /api/orders/:id/items - Get order items
const getOrderItems = async (req, res) => {
    try {
        const { id } = req.params;
        
        let query;
        let values;
        
        if (req.user.role === 'FARMER') {
            const farmerResult = await Farmer.findByUserId(req.user.user_id);
            if (farmerResult.rows.length === 0) {
                return res.status(403).json({ 
                    success: false, 
                    error: 'User is not a registered farmer' 
                });
            }
            const farmer_id = farmerResult.rows[0].farmer_id;
            
            query = `
                SELECT 
                    oi.order_item_id,
                    oi.order_id,
                    oi.product_id,
                    oi.quantity,
                    oi.price,
                    p.product_name,
                    p.image_url,
                    p.category,
                    p.description
                FROM order_items oi
                JOIN products p ON oi.product_id = p.product_id
                WHERE oi.order_id = $1 AND p.farmer_id = $2
            `;
            values = [id, farmer_id];
        } else {
            query = `
                SELECT 
                    oi.order_item_id,
                    oi.order_id,
                    oi.product_id,
                    oi.quantity,
                    oi.price,
                    p.product_name,
                    p.image_url,
                    p.category,
                    p.description
                FROM order_items oi
                JOIN products p ON oi.product_id = p.product_id
                WHERE oi.order_id = $1
            `;
            values = [id];
        }

        const result = await db.query(query, values);
        
        res.json({
            success: true,
            items: result.rows
        });

    } catch (error) {
        console.error('Get order items error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error',
            details: error.message 
        });
    }
};

// PUT /api/orders/:id/status - Update order status
const updateOrderStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        // Validate status
        const validStatuses = ['PENDING', 'CONFIRMED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid status value. Must be one of: ' + validStatuses.join(', ') 
            });
        }

        // Check if order belongs to this farmer (has their products)
        const farmerResult = await Farmer.findByUserId(req.user.user_id);
        
        if (farmerResult.rows.length === 0) {
            return res.status(403).json({ 
                success: false, 
                error: 'User is not a registered farmer' 
            });
        }

        const farmer_id = farmerResult.rows[0].farmer_id;

        // Verify order exists and farmer has items in it
        const checkQuery = `
            SELECT o.order_id 
            FROM orders o
            WHERE o.order_id = $1 AND EXISTS (
                SELECT 1
                FROM order_items oi
                JOIN products p ON oi.product_id = p.product_id
                WHERE oi.order_id = o.order_id AND p.farmer_id = $2
            )
        `;
        const checkResult = await db.query(checkQuery, [id, farmer_id]);
        
        if (checkResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Order not found or not authorized' 
            });
        }

        // Update status
        const updateQuery = `
            UPDATE orders 
            SET order_status = $1 
            WHERE order_id = $2 
            RETURNING *
        `;

        const result = await db.query(updateQuery, [status, id]);
        
        // Transform the response
        const updatedOrder = {
            order_id: result.rows[0].order_id,
            customer_id: result.rows[0].customer_id,
            farmer_id: result.rows[0].farmer_id,
            total_amount: parseFloat(result.rows[0].total_amount),
            status: result.rows[0].order_status,
            payment_method: result.rows[0].payment_method,
            delivery_option: result.rows[0].delivery_option,
            address: result.rows[0].address,
            delivery_address: result.rows[0].address,
            contact_number: result.rows[0].contact_number,
            order_date: result.rows[0].order_date
        };
        
        res.json({
            success: true,
            message: 'Order status updated successfully',
            order: updatedOrder
        });

    } catch (error) {
        console.error('Update order status error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error',
            details: error.message 
        });
    }
};

// GET /api/orders/my-purchases - Get orders placed by the logged-in user (any role)
const getMyPurchases = async (req, res) => {
    try {
        const user_id = req.user.user_id; // works for both customers and farmers

        const query = `
            SELECT 
                o.order_id,
                o.customer_id,
                o.farmer_id,
                o.total_amount,
                o.order_status as status,
                o.payment_method,
                o.delivery_option,
                o.address,
                o.contact_number,
                o.order_date,
                f.farm_name,
                (
                    SELECT COALESCE(json_agg(
                        json_build_object(
                            'order_item_id', oi.order_item_id,
                            'product_id', oi.product_id,
                            'product_name', p.product_name,
                            'quantity', oi.quantity,
                            'price', oi.price,
                            'image_url', p.image_url
                        )
                    ), '[]'::json)
                    FROM order_items oi
                    JOIN products p ON oi.product_id = p.product_id
                    WHERE oi.order_id = o.order_id
                ) as items
            FROM orders o
            LEFT JOIN farmers f ON o.farmer_id = f.farmer_id
            WHERE o.customer_id = $1
            ORDER BY o.order_date DESC
        `;

        const result = await db.query(query, [user_id]);
        
        // Transform the data for frontend
        const orders = result.rows.map(order => ({
            ...order,
            delivery_address: order.address,
            items: order.items || []
        }));
        
        res.json({
            success: true,
            orders: orders
        });

    } catch (error) {
        console.error('Get my purchases error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error',
            details: error.message 
        });
    }
};

// Make sure ALL functions are exported
module.exports = {
    createOrder,
    getCustomerOrders,
    getFarmerOrders,
    getOrderById,
    getOrderItems,
    updateOrderStatus,
    getMyPurchases
};