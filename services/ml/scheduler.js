const cron = require('node-cron');
const simpleDemandPredictor = require('./simpleDemandPredictor');

// Retrain model every Sunday at midnight
cron.schedule('0 0 * * 0', async () => {
    console.log('🕐 Running scheduled model retraining...');
    
    try {
        const success = await simpleDemandPredictor.trainModel();
        
        if (success) {
            console.log('✅ Scheduled retraining completed');
        } else {
            console.log('❌ Scheduled retraining failed');
        }
    } catch (error) {
        console.error('Scheduled retraining error:', error);
    }
});

console.log('⏰ ML scheduler started');