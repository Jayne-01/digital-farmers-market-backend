// models/orderModel.js
const db = require('../config/database');

class Order {
    // Create a new order (for direct purchase - without cart)
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
        
        console.log('Order.create called with:', orderData);
        
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
            
            console.log('Executing query with values:', values);
            console.log('Number of values:', values.length); 
            
            const result = await db.query(query, values);
            console.log('Query result:', result.rows[0]);
            
            return result.rows[0];
            
        } catch (error) {
            console.error('Error in Order.create:', error);
            console.error('Error details:', {
                message: error.message,
                code: error.code,
                position: error.position
            });
            throw error;
        }
    }

    // Add item to an order
    static async addOrderItem(order_id, itemData) {
        const { product_id, quantity, price } = itemData;
        
        try {
            const query = `
                INSERT INTO order_items (order_id, product_id, quantity, price)
                VALUES ($1, $2, $3, $4)
                RETURNING *
            `;
            const result = await db.query(query, [order_id, product_id, quantity, price]);
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
                u.contact_number as farmer_contact
            FROM orders o
            JOIN farmers f ON o.farmer_id = f.farmer_id
            JOIN users u ON f.user_id = u.user_id
            WHERE o.customer_id = $1
            ORDER BY o.order_date DESC
        `;
        const result = await db.query(query, [customer_id]);
        console.log(`Found ${result.rows.length} orders for customer ${customer_id}`); 
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
                    u.address
                FROM orders o
                JOIN users u ON o.customer_id = u.user_id
                WHERE o.farmer_id = $1
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
                    fu.contact_number as farmer_contact
                FROM orders o
                JOIN users u ON o.customer_id = u.user_id
                JOIN farmers f ON o.farmer_id = f.farmer_id
                JOIN users fu ON f.user_id = fu.user_id
                WHERE o.order_id = $1
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
                    p.product_name,
                    p.category,
                    p.image_url
                FROM order_items oi
                JOIN products p ON oi.product_id = p.product_id
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