const db = require('../config/database');

class Farmer {
    // CREATE a new farmer profile 
    static async create(user_id, farmerData) {
        const { farm_name, barangay, farm_description, product_categories } = farmerData;
        const query = `
            INSERT INTO farmers (
                user_id, 
                farm_name, 
                barangay, 
                farm_description, 
                product_categories
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `;
        return await db.query(query, [
            user_id, 
            farm_name, 
            barangay, 
            farm_description || null, 
            product_categories || null
        ]);
    }

    // FIND farmer by user_id 
    static async findByUserId(user_id) {
        const query = `
            SELECT 
                f.farmer_id,
                f.user_id,
                f.farm_name,
                f.barangay,
                f.farm_description,
                f.product_categories,
                f.verified_status,
                f.created_at,
                f.updated_at,
                u.full_name, 
                u.email, 
                u.contact_number, 
                u.address
            FROM farmers f
            JOIN users u ON f.user_id = u.user_id
            WHERE f.user_id = $1 AND u.status = 'ACTIVE'
        `;
        return await db.query(query, [user_id]);
    }

    // GET all farmers
    static async getAllFarmers() {
        const query = `
            SELECT 
                f.farmer_id,
                f.user_id,
                f.farm_name,
                f.barangay,
                f.farm_description,
                f.product_categories,
                f.verified_status,
                f.created_at,
                u.full_name, 
                u.email, 
                u.contact_number, 
                u.address
            FROM farmers f
            JOIN users u ON f.user_id = u.user_id
            WHERE u.status = 'ACTIVE'
        `;
        return await db.query(query);
    }

    // UPDATE farmer profile 
    static async updateFarmerProfile(farmer_id, updateData) {
        // Build dynamic update query
        const allowedFields = [
            'farm_name', 
            'barangay', 
            'farm_description', 
            'product_categories', 
            'verified_status'
        ];
        
        // Filter only allowed fields that are present in updateData
        const fieldsToUpdate = Object.keys(updateData)
            .filter(key => allowedFields.includes(key))
            .map((key, index) => `${key} = $${index + 2}`);
        
        if (fieldsToUpdate.length === 0) {
            throw new Error('No valid fields to update');
        }
        
        const values = Object.keys(updateData)
            .filter(key => allowedFields.includes(key))
            .map(key => updateData[key]);
        
        const query = `
            UPDATE farmers 
            SET ${fieldsToUpdate.join(', ')}, updated_at = NOW() 
            WHERE farmer_id = $1 
            RETURNING *
        `;
        
        return await db.query(query, [farmer_id, ...values]);
    }

    // GET farmer statistics
    static async getFarmerStats(farmer_id) {
        const query = `
            SELECT 
                f.farmer_id,
                f.farm_name,
                COUNT(DISTINCT p.product_id) as total_products,
                COUNT(DISTINCT o.order_id) as total_orders,
                COALESCE(SUM(o.total_amount), 0) as total_sales
            FROM farmers f
            LEFT JOIN products p ON f.farmer_id = p.farmer_id
            LEFT JOIN orders o ON f.farmer_id = o.farmer_id AND o.order_status = 'DELIVERED'
            WHERE f.farmer_id = $1
            GROUP BY f.farmer_id, f.farm_name
        `;
        return await db.query(query, [farmer_id]);
    }

    // GET unavailable products
    static async getUnavailableProducts(farmer_id) {
        const query = `
            SELECT * FROM products 
            WHERE farmer_id = $1 
            AND status = 'UNAVAILABLE'
            ORDER BY updated_at DESC
            LIMIT 5
        `;
        return await db.query(query, [farmer_id]);
    }
}

module.exports = Farmer;