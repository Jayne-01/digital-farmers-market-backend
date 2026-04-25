// ========== CLASSIFIER KEEP-ALIVE PING ==========
// Prevents Render free tier from sleeping and causing timeouts
const CLASSIFIER_URL = process.env.CLASSIFIER_URL || 'https://farm-classifier.onrender.com';
const KEEP_ALIVE_INTERVAL = 4 * 60 * 1000; // Every 4 minutes

async function pingClassifier() {
    try {
        const response = await axios.get(`${CLASSIFIER_URL}/classify/health`, {
            timeout: 10000
        });
        if (response.data && response.data.status === 'healthy') {
            console.log('✅ Classifier keep-alive: Service is healthy');
        } else {
            console.log('⚠️ Classifier keep-alive: Service responded but status unknown');
        }
    } catch (error) {
        console.log('⚠️ Classifier keep-alive ping failed:', error.message);
    }
}

// Start keep-alive after server starts
setTimeout(() => {
    pingClassifier(); // Initial ping
    setInterval(pingClassifier, KEEP_ALIVE_INTERVAL);
    console.log('🔄 Classifier keep-alive service started (pings every 4 minutes)');
}, 5000); // Wait 5 seconds after server start
// ============================================