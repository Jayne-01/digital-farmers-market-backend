// models/orderModel.js
const db = require('../config/database');

class Order {
    // Create a new order
    static async create(orderData) {
        const { 
            customer_id, 
            farmer_id, 
            total_amount, 
            delivery_option,
            address,
            contact_number,
            payment_method
        } = orderData;
        
        try {
            const query = `
                INSERT INTO orders (
                    customer_id, 
                    farmer_id, 
                    total_amount, 
                    address,
                    contact_number,
                    delivery_option,
                    payment_method,
                    order_status,
                    order_date
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
                RETURNING *
            `;
            
            const values = [
                customer_id, 
                farmer_id, 
                total_amount, 
                address || null,
                contact_number || null,
                delivery_option || 'Pick-Up',  
                payment_method || 'COD',
                'PENDING'
            ];
            
            const result = await db.query(query, values);
            return result.rows[0];
            
        } catch (error) {
            console.error('Error in Order.create:', error);
            throw error;
        }
    }

    // Add item to an order - WITH product_name_snapshot AND product_image_snapshot
    static async addOrderItem(order_id, itemData) {
        const { product_id, quantity, price, product_name, product_image } = itemData;
        
        try {
            const query = `
                INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_image_snapshot, quantity, price)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *
            `;
            const result = await db.query(query, [order_id, product_id, product_name, product_image, quantity, price]);
            return result.rows[0];
        } catch (error) {
            console.error('Error in Order.addOrderItem:', error);
            throw error;
        }
    }

    // Find orders by customer
    static async findByCustomer(customer_id) {
        try {
            const query = `
                SELECT 
                    o.*,
                    f.farm_name,
                    u.full_name as farmer_name,
                    u.contact_number as farmer_contact,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'product_id', oi.product_id,
                                'product_name', COALESCE(oi.product_name_snapshot, p.product_name, 'Product #' || oi.product_id),
                                'product_image', COALESCE(oi.product_image_snapshot, p.image_url, ''),
                                'quantity', oi.quantity,
                                'price', oi.price,
                                'is_deleted', CASE WHEN p.product_id IS NULL THEN true ELSE false END
                            ) ORDER BY oi.order_item_id
                        ) FILTER (WHERE oi.product_id IS NOT NULL), 
                        '[]'::json
                    ) as items
                FROM orders o
                LEFT JOIN order_items oi ON o.order_id = oi.order_id
                LEFT JOIN products p ON oi.product_id = p.product_id
                JOIN farmers f ON o.farmer_id = f.farmer_id
                JOIN users u ON f.user_id = u.user_id
                WHERE o.customer_id = $1
                GROUP BY o.order_id, f.farm_name, u.full_name, u.contact_number
                ORDER BY o.order_date DESC
            `;
            const result = await db.query(query, [customer_id]);
            return result.rows;
        } catch (error) {
            console.error('Error in Order.findByCustomer:', error);
            throw error;
        }
    }

    // Find orders by farmer
    static async findByFarmer(farmer_id) {
        try {
            const query = `
                SELECT 
                    o.*,
                    u.full_name as customer_name,
                    u.contact_number,
                    u.address,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'product_id', oi.product_id,
                                'product_name', COALESCE(oi.product_name_snapshot, p.product_name, 'Product #' || oi.product_id),
                                'product_image', COALESCE(oi.product_image_snapshot, p.image_url, ''),
                                'quantity', oi.quantity,
                                'price', oi.price,
                                'is_deleted', CASE WHEN p.product_id IS NULL THEN true ELSE false END
                            ) ORDER BY oi.order_item_id
                        ) FILTER (WHERE oi.product_id IS NOT NULL), 
                        '[]'::json
                    ) as items
                FROM orders o
                LEFT JOIN order_items oi ON o.order_id = oi.order_id
                LEFT JOIN products p ON oi.product_id = p.product_id
                JOIN users u ON o.customer_id = u.user_id
                WHERE o.farmer_id = $1
                GROUP BY o.order_id, u.full_name, u.contact_number, u.address
                ORDER BY o.order_date DESC
            `;
            const result = await db.query(query, [farmer_id]);
            return result.rows;
        } catch (error) {
            console.error('Error in Order.findByFarmer:', error);
            throw error;
        }
    }

    // Find order by ID with all details
    static async findById(order_id) {
        try {
            const query = `
                SELECT 
                    o.*,
                    u.full_name as customer_name,
                    u.contact_number,
                    u.address as customer_address,
                    f.farm_name,
                    fu.full_name as farmer_name,
                    fu.contact_number as farmer_contact,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'product_id', oi.product_id,
                                'product_name', COALESCE(oi.product_name_snapshot, p.product_name, 'Product #' || oi.product_id),
                                'product_image', COALESCE(oi.product_image_snapshot, p.image_url, ''),
                                'quantity', oi.quantity,
                                'price', oi.price,
                                'is_deleted', CASE WHEN p.product_id IS NULL THEN true ELSE false END
                            ) ORDER BY oi.order_item_id
                        ) FILTER (WHERE oi.product_id IS NOT NULL), 
                        '[]'::json
                    ) as items
                FROM orders o
                LEFT JOIN order_items oi ON o.order_id = oi.order_id
                LEFT JOIN products p ON oi.product_id = p.product_id
                JOIN users u ON o.customer_id = u.user_id
                JOIN farmers f ON o.farmer_id = f.farmer_id
                JOIN users fu ON f.user_id = fu.user_id
                WHERE o.order_id = $1
                GROUP BY o.order_id, u.full_name, u.contact_number, u.address, f.farm_name, fu.full_name, fu.contact_number
            `;
            const result = await db.query(query, [order_id]);
            return result.rows[0];
        } catch (error) {
            console.error('Error in Order.findById:', error);
            throw error;
        }
    }

    // Get items for an order
    static async getOrderItems(order_id) {
        try {
            const query = `
                SELECT 
                    oi.*,
                    COALESCE(oi.product_name_snapshot, p.product_name, 'Product #' || oi.product_id) as product_name,
                    COALESCE(oi.product_image_snapshot, p.image_url, '') as product_image,
                    p.category,
                    CASE WHEN p.product_id IS NULL THEN true ELSE false END as is_deleted
                FROM order_items oi
                LEFT JOIN products p ON oi.product_id = p.product_id
                WHERE oi.order_id = $1
            `;
            const result = await db.query(query, [order_id]);
            return result.rows;
        } catch (error) {
            console.error('Error in Order.getOrderItems:', error);
            throw error;
        }
    }

    // Update order status
    static async updateStatus(order_id, status) {
        try {
            const query = `
                UPDATE orders 
                SET order_status = $1 
                WHERE order_id = $2 
                RETURNING *
            `;
            const result = await db.query(query, [status, order_id]);
            return result.rows[0];
        } catch (error) {
            console.error('Error in Order.updateStatus:', error);
            throw error;
        }
    }
}

module.exports = Order;