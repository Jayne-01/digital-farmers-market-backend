// services/ml/randomForestPredictor.js
const { RandomForestRegression } = require('ml-random-forest');
const pool = require('../../config/database');

class RandomForestPredictor {
    constructor() {
        this.model = null;
        this.isTrained = false;
        this.trainingHistory = [];
    }

    async predictDemandScore(product) {
        if (!this.isTrained || !this.model) {
            return this.fallbackScore(product);
        }
        
        try {
            const totalSales = Number(product.total_sales) || 0;
            const searchFreq = Number(product.search_frequency) || 0;
            const price = Number(product.price) || 0;
            
            const features = [[totalSales, searchFreq, price]];
            const prediction = this.model.predict(features);
            const score = prediction[0];
            
            return Math.min(Math.max(score, 0), 10);
        } catch (error) {
            console.error('Prediction error:', error.message);
            return this.fallbackScore(product);
        }
    }

    async trainModel() {
        console.log('🔄 Training Random Forest model...');
        
        try {
            const trainingData = await pool.query(`
                SELECT 
                    COALESCE(total_sales, 0) as total_sales,
                    COALESCE(search_frequency, 0) as search_frequency,
                    COALESCE(price_range_min, 0) as price,
                    COALESCE(base_demand_score, 5) as actual_demand
                FROM market_product_demand
                WHERE base_demand_score IS NOT NULL
            `);
            
            if (trainingData.rows.length < 5) {
                console.log('⚠️ Not enough data for training');
                return false;
            }
            
            const features = [];
            const targets = [];
            
            for (const row of trainingData.rows) {
                const totalSales = Number(row.total_sales);
                const searchFreq = Number(row.search_frequency);
                const price = Number(row.price);
                const demand = Number(row.actual_demand);
                
                if (isNaN(totalSales) || isNaN(searchFreq) || isNaN(price) || isNaN(demand)) {
                    continue;
                }
                
                features.push([totalSales, searchFreq, price]);
                targets.push(demand);
            }
            
            if (features.length < 5) {
                console.log('⚠️ Not enough valid training samples');
                return false;
            }
            
            console.log(`📊 Training with ${features.length} samples`);
            
            const options = {
                seed: 42,
                maxFeatures: 2,
                nEstimators: 50,
                treeOptions: {
                    maxDepth: 5,
                    minSamplesSplit: 2,
                    minSamplesLeaf: 1
                }
            };
            
            this.model = new RandomForestRegression(options);
            this.model.train(features, targets);
            this.isTrained = true;
            
            console.log(`✅ Random Forest model trained successfully!`);
            return true;
            
        } catch (error) {
            console.error('❌ Training failed:', error.message);
            return false;
        }
    }

    fallbackScore(product) {
        let score = 0;
        const sales = Number(product.total_sales) || 0;
        const searches = Number(product.search_frequency) || 0;
        const price = Number(product.price) || 0;
        
        score += Math.min(sales / 100, 5) * 1.2;
        score += Math.min(searches / 50, 3);
        score += price < 50 ? 1 : (price < 100 ? 0.5 : 0);
        
        return Math.min(score, 10);
    }
}

module.exports = new RandomForestPredictor();