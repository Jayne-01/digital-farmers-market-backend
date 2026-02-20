const db = require('../config/database');

class Recommendation {
    static async getMarketInsights(farmer_id) {
    const query = `
        WITH product_stats AS (
            SELECT 
                p.product_id,
                p.product_name,
                p.category,
                p.price,
                COUNT(DISTINCT pv.view_id) as view_count,
                COUNT(DISTINCT oi.order_item_id) as order_count
            FROM products p
            LEFT JOIN product_views pv ON p.product_id = pv.product_id
            LEFT JOIN order_items oi ON p.product_id = oi.product_id
            LEFT JOIN orders o ON oi.order_id = o.order_id 
                AND o.order_status = 'DELIVERED'
            WHERE p.farmer_id = $1
            GROUP BY p.product_id, p.product_name, p.category, p.price
        )
        SELECT 
            ps.*,
            CASE 
                WHEN ps.view_count > 0 THEN 'Active'
                ELSE 'No views'
            END as status,
            ROUND(
                (COALESCE(ps.view_count, 0) * 0.4 + COALESCE(ps.order_count, 0) * 0.6)::numeric,
                2
            ) as demand_score
        FROM product_stats ps
        ORDER BY demand_score DESC
        LIMIT 5
    `;
    return await db.query(query, [farmer_id]);
}
    static async getSeasonalRecommendations() {
        const currentMonth = new Date().getMonth() + 1;
        
        const query = `
            SELECT 
                category,
                COUNT(*) as total_listings,
                AVG(price) as avg_price,
                EXTRACT(MONTH FROM harvest_date) as harvest_month
            FROM products 
            WHERE status = 'AVAILABLE' 
            AND harvest_date IS NOT NULL
            GROUP BY category, EXTRACT(MONTH FROM harvest_date)
            HAVING EXTRACT(MONTH FROM harvest_date) BETWEEN $1 AND $2
            ORDER BY total_listings DESC
        `;
        
        // Look for products harvested in current and next month
        return await db.query(query, [currentMonth, (currentMonth % 12) + 1]);
    }

    static async getPersonalizedRecommendations(user_id) {
        // Query for user's recently viewed products
        const viewedQuery = `
            SELECT p.*, pv.viewed_at
            FROM product_views pv
            JOIN products p ON pv.product_id = p.product_id
            WHERE pv.user_id = $1
            ORDER BY pv.viewed_at DESC
            LIMIT 10
        `;
        
        // Query for similar products based on viewed categories
        const similarQuery = `
            SELECT p.*, f.farm_name
            FROM products p
            JOIN farmers f ON p.farmer_id = f.farmer_id
            WHERE p.category IN (
                SELECT DISTINCT category 
                FROM product_views pv
                JOIN products p ON pv.product_id = p.product_id
                WHERE pv.user_id = $1
            )
            AND p.status = 'AVAILABLE'
            AND p.product_id NOT IN (
                SELECT product_id FROM product_views WHERE user_id = $1
            )
            ORDER BY RANDOM()
            LIMIT 5
        `;
        
        // Query for trending products
        const trendingQuery = `
            SELECT 
                p.product_id,
                p.product_name,
                p.category,
                p.price,
                p.description,
                p.image_url,
                p.status,
                p.harvest_date,
                f.farm_name,
                f.farmer_id,
                COUNT(DISTINCT pv.view_id) as view_count,
                COUNT(DISTINCT oi.order_item_id) as purchase_count
            FROM products p
            JOIN farmers f ON p.farmer_id = f.farmer_id
            LEFT JOIN product_views pv ON p.product_id = pv.product_id 
                AND pv.viewed_at > CURRENT_DATE - INTERVAL '7 days'
            LEFT JOIN order_items oi ON p.product_id = oi.product_id
            LEFT JOIN orders o ON oi.order_id = o.order_id
                AND o.order_date > CURRENT_DATE - INTERVAL '7 days'
                AND o.order_status IN ('COMPLETED', 'DELIVERED')
            WHERE p.status = 'AVAILABLE'
            GROUP BY p.product_id, f.farm_name, f.farmer_id
            HAVING COUNT(DISTINCT pv.view_id) > 0 OR COUNT(DISTINCT oi.order_item_id) > 0
            ORDER BY (COUNT(DISTINCT pv.view_id) * 0.6 + COUNT(DISTINCT oi.order_item_id) * 0.4) DESC
            LIMIT 5
        `;

        return Promise.all([
            db.query(viewedQuery, [user_id]),
            db.query(similarQuery, [user_id]),
            db.query(trendingQuery)
        ]);
    }

    static async getDemandAnalysis(farmer_id) {
    const demandQuery = `
        WITH product_metrics AS (
            SELECT 
                p.product_id,
                p.product_name,
                p.category,
                COUNT(DISTINCT pv.view_id) as freq_c,
                CASE 
                    WHEN COUNT(DISTINCT oi.order_item_id) > 0 THEN 1.0
                    ELSE 0.5
                END as price_trend_c,
                COUNT(CASE WHEN o.order_status = 'PENDING' THEN 1 END) as unmet_demand_c
            FROM products p
            LEFT JOIN product_views pv ON p.product_id = pv.product_id
            LEFT JOIN order_items oi ON p.product_id = oi.product_id
            LEFT JOIN orders o ON oi.order_id = o.order_id
            WHERE p.farmer_id = $1
            AND p.status = 'AVAILABLE'
            GROUP BY p.product_id, p.product_name, p.category
        )
        SELECT 
            *,
            ROUND(
                (freq_c * 0.4) + 
                (price_trend_c * 0.3) + 
                (unmet_demand_c * 0.3),
                2
            ) as demand_score
        FROM product_metrics
        ORDER BY demand_score DESC
    `;

    return await db.query(demandQuery, [farmer_id]);
}
}

module.exports = Recommendation;