const Farmer = require('../models/farmerModel');
const Product = require('../models/productModel');
const Order = require('../models/orderModel');
const db = require('../config/database');

const getFarmerDashboard = async (req, res) => {
    try {
        // Get farmer details
        const farmerResult = await Farmer.findByUserId(req.user.user_id);
        if (farmerResult.rows.length === 0) {
            return res.status(403).json({ error: 'User is not a registered farmer' });
        }

        const farmer = farmerResult.rows[0];
        const farmer_id = farmer.farmer_id;

        // Get farmer statistics
        const statsResult = await Farmer.getFarmerStats(farmer_id);
        
        // Get recent orders
        let recentOrders = { rows: [] };
        try {
            const ordersQuery = `
                SELECT o.*, u.full_name as customer_name
                FROM orders o
                JOIN users u ON o.customer_id = u.user_id
                WHERE o.farmer_id = $1
                ORDER BY o.order_date DESC
                LIMIT 5
            `;
            const ordersResult = await db.query(ordersQuery, [farmer_id]);
            recentOrders = ordersResult || { rows: [] };
        } catch (orderError) {
            console.error('Error fetching orders:', orderError);
        }

        // Get unavailable products
        let unavailableProducts = { rows: [] };
        try {
            const unavailableQuery = `
                SELECT * FROM products 
                WHERE farmer_id = $1 
                AND status = 'UNAVAILABLE'
                ORDER BY updated_at DESC
                LIMIT 5
            `;
            const unavailableResult = await db.query(unavailableQuery, [farmer_id]);
            unavailableProducts = unavailableResult || { rows: [] };
        } catch (unavailableError) {
            console.error('Error fetching unavailable products:', unavailableError);
        }

        
        res.json({
            farmer: {
                farmer_id: farmer.farmer_id,
                farm_name: farmer.farm_name,
                barangay: farmer.barangay,
                farm_description: farmer.farm_description, 
                verified_status: farmer.verified_status || false
            },
            statistics: statsResult.rows[0] || {
                total_products: 0,
                total_orders: 0,
                total_sales: 0
            },
            recent_orders: recentOrders.rows.slice(0, 5),
            unavailable_products: unavailableProducts.rows.slice(0, 5)
        });
        
    } catch (error) {
        console.error('Get farmer dashboard error:', error);
        res.status(500).json({ 
            error: 'Server error',
            message: error.message
        });
    }
};

const updateFarmerProfile = async (req, res) => {
    try {
    
        const { farm_name, barangay, farm_description } = req.body;
        
        const farmerResult = await Farmer.findByUserId(req.user.user_id);
        if (farmerResult.rows.length === 0) {
            return res.status(403).json({ error: 'User is not a registered farmer' });
        }

        const farmer_id = farmerResult.rows[0].farmer_id;
        const updateData = {};

        if (farm_name) updateData.farm_name = farm_name;
        if (barangay) updateData.barangay = barangay;
        if (farm_description) updateData.farm_description = farm_description; 

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ error: 'No data provided for update' });
        }

        const result = await Farmer.updateFarmerProfile(farmer_id, updateData);
        
        res.json({
            message: 'Farmer profile updated successfully',
            farmer: result.rows[0]
        });
    } catch (error) {
        console.error('Update farmer profile error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const getFarmerSalesReport = async (req, res) => {
    try {
        const farmerResult = await Farmer.findByUserId(req.user.user_id);
        if (farmerResult.rows.length === 0) {
            return res.status(403).json({ error: 'User is not a registered farmer' });
        }

        const farmer_id = farmerResult.rows[0].farmer_id;
        const { period = 'monthly' } = req.query;

        let dateRange;
        switch (period) {
            case 'weekly':
                dateRange = "CURRENT_DATE - INTERVAL '7 days'";
                break;
            case 'monthly':
                dateRange = "CURRENT_DATE - INTERVAL '30 days'";
                break;
            case 'yearly':
                dateRange = "CURRENT_DATE - INTERVAL '365 days'";
                break;
            default:
                dateRange = "CURRENT_DATE - INTERVAL '30 days'";
        }

        const salesQuery = `
            SELECT 
                DATE(o.order_date) as order_date,
                COUNT(DISTINCT o.order_id) as total_orders,
                SUM(o.total_amount) as total_sales,
                SUM(oi.quantity) as total_items_sold
            FROM orders o
            JOIN order_items oi ON o.order_id = oi.order_id
            WHERE o.farmer_id = $1
            AND o.order_date >= ${dateRange}
            AND o.order_status = 'DELIVERED'
            GROUP BY DATE(o.order_date)
            ORDER BY DATE(o.order_date) DESC
        `;

        const productSalesQuery = `
            SELECT 
                p.product_name,
                p.category,
                SUM(oi.quantity) as quantity_sold,
                SUM(oi.quantity * oi.price) as revenue
            FROM products p
            JOIN order_items oi ON p.product_id = oi.product_id
            JOIN orders o ON oi.order_id = o.order_id
            WHERE p.farmer_id = $1
            AND o.order_date >= ${dateRange}
            AND o.order_status = 'DELIVERED'
            GROUP BY p.product_id, p.product_name, p.category
            ORDER BY revenue DESC
        `;

        const [salesResult, productSalesResult] = await Promise.all([
            db.query(salesQuery, [farmer_id]),
            db.query(productSalesQuery, [farmer_id])
        ]);

        res.json({
            period,
            sales_report: salesResult.rows,
            product_performance: productSalesResult.rows,
            summary: {
                total_sales: salesResult.rows.reduce((sum, row) => sum + parseFloat(row.total_sales || 0), 0),
                total_orders: salesResult.rows.reduce((sum, row) => sum + parseInt(row.total_orders || 0), 0),
                total_items_sold: salesResult.rows.reduce((sum, row) => sum + parseInt(row.total_items_sold || 0), 0)
            }
        });
    } catch (error) {
        console.error('Get farmer sales report error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const getFarmerInventory = async (req, res) => {
    try {
        const farmerResult = await Farmer.findByUserId(req.user.user_id);
        if (farmerResult.rows.length === 0) {
            return res.status(403).json({ error: 'User is not a registered farmer' });
        }

        const farmer_id = farmerResult.rows[0].farmer_id;
        const { category, status, sortBy = 'created_at', sortOrder = 'DESC' } = req.query;

        let query = `
            SELECT 
                p.*,
                COUNT(DISTINCT oi.order_item_id) as times_sold,
                COUNT(DISTINCT pv.view_id) as view_count
            FROM products p
            LEFT JOIN order_items oi ON p.product_id = oi.product_id
            LEFT JOIN product_views pv ON p.product_id = pv.product_id
            WHERE p.farmer_id = $1
        `;
        
        const values = [farmer_id];
        let paramIndex = 2;

        if (category) {
            query += ` AND p.category = $${paramIndex}`;
            values.push(category);
            paramIndex++;
        }

        if (status) {
            query += ` AND p.status = $${paramIndex}`;
            values.push(status);
            paramIndex++;
        }

        query += ` GROUP BY p.product_id ORDER BY p.${sortBy} ${sortOrder}`;
        
        const result = await db.query(query, values);
        
        const summary = {
            total_products: result.rows.length,
            total_available: result.rows.filter(p => p.status === 'AVAILABLE').length,
            total_unavailable: result.rows.filter(p => p.status === 'UNAVAILABLE').length
        };

        res.json({
            inventory: result.rows,
            summary
        });
    } catch (error) {
        console.error('Get farmer inventory error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = {
    getFarmerDashboard,
    updateFarmerProfile,
    getFarmerSalesReport,
    getFarmerInventory
};