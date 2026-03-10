const { RandomForestRegression } = require('ml-random-forest');
const pool = require('../../config/database'); 

class SimpleDemandPredictor {
    constructor() {
        this.model = null;
        this.isTrained = false;
    }

    // Train the model with historical data
    async trainModel() {
        console.log('🔄 Training simplified Random Forest model...');
        
        try {
            // Get training data from PostgreSQL
            const trainingData = await this.getTrainingData();
            
            if (trainingData.length < 5) {
                console.log('⚠️ Not enough data for training. Need at least 5 products.');
                return false;
            }

            // Prepare features [view_count, times_sold, price] and targets
            const features = [];
            const targets = [];

            trainingData.forEach(item => {
                features.push([
                    item.view_count || 0,
                    item.times_sold || 0,
                    parseFloat(item.price) || 0
                ]);
                targets.push(item.actual_demand || 0);
            });

            // Configure Random Forest (simplified)
            const options = {
                seed: 42,
                maxFeatures: 2,           // Use 2 features per tree
                replacement: true,
                nEstimators: 50,           // Fewer trees since we have less data
                treeOptions: {
                    maxDepth: 5
                }
            };

            // Create and train model
            this.model = new RandomForestRegression(options);
            this.model.train(features, targets);
            this.isTrained = true;

            console.log('✅ Simplified model trained successfully!');
            return true;

        } catch (error) {
            console.error('❌ Training failed:', error);
            return false;
        }
    }

    // Get training data from PostgreSQL
    async getTrainingData() {
        // Get all products with their performance - UPDATED with correct column names and order_status
        const query = `
            SELECT 
                p.product_id as id,
                p.product_name as name,
                p.price,
                p.view_count,
                COALESCE(SUM(oi.quantity), 0) as times_sold
            FROM products p
            LEFT JOIN order_items oi ON oi.product_id = p.product_id
            LEFT JOIN orders o ON o.order_id = oi.order_id AND o.order_status = 'DELIVERED'
            GROUP BY p.product_id, p.product_name, p.price, p.view_count
        `;
        
        const result = await pool.query(query);
        const products = result.rows;

        const trainingData = [];

        for (const product of products) {
            // Calculate actual demand score based on real performance
            const actualDemand = this.calculateActualDemand(
                product.view_count || 0,
                parseInt(product.times_sold) || 0,
                parseFloat(product.price) || 0
            );

            trainingData.push({
                view_count: product.view_count || 0,
                times_sold: parseInt(product.times_sold) || 0,
                price: parseFloat(product.price) || 0,
                actual_demand: actualDemand
            });
        }

        return trainingData;
    }

    // Predict demand for a single product
    async predictDemand(product) {
        if (!this.isTrained || !this.model) {
            return this.calculateFallbackScore(product);
        }

        try {
            const features = [[
                product.view_count || 0,
                product.times_sold || 0,
                parseFloat(product.price) || 0
            ]];

            const prediction = this.model.predict(features);
            
            // Normalize to 0-10 and round to 1 decimal
            const score = Math.min(Math.max(prediction[0], 0), 10);
            return Math.round(score * 10) / 10;

        } catch (error) {
            console.error('Prediction error:', error);
            return this.calculateFallbackScore(product);
        }
    }

    // Predict demand for multiple products
    async predictBulkDemand(products) {
        if (!this.isTrained || !this.model) {
            return products.map(p => ({
                ...p,
                demand_score: this.calculateFallbackScore(p)
            }));
        }

        const results = [];

        for (const product of products) {
            const demandScore = await this.predictDemand(product);
            results.push({
                ...product,
                demand_score: demandScore
            });
        }

        return results;
    }

    // Calculate actual demand from performance (for training)
    calculateActualDemand(views, sold, price) {
        let score = 0;
        
        // Views contribute up to 4 points
        score += Math.min(views / 50, 4);  // 200 views = 4 points
        
        // Sales contribute up to 5 points
        score += Math.min(sold * 1.5, 5);  // 3-4 sales = 5 points
        
        // Price factor (0-1 point)
        if (price < 100) score += 1;       // Cheap products
        else if (price < 500) score += 0.5; // Medium price
        
        return Math.min(score, 10);
    }

    // Fallback scoring when model isn't trained
    calculateFallbackScore(product) {
        let score = 0;
        
        // Views (0-4 points)
        const views = product.view_count || 0;
        score += Math.min(views / 50, 4);
        
        // Sales (0-5 points)
        const sold = product.times_sold || 0;
        score += Math.min(sold * 1.5, 5);
        
        // Price (0-1 point)
        const price = parseFloat(product.price) || 0;
        if (price < 100) score += 1;
        else if (price < 500) score += 0.5;
        
        return Math.min(Math.round(score * 10) / 10, 10);
    }
}

module.exports = new SimpleDemandPredictor();