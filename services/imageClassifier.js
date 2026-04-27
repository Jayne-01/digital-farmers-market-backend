const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');

// Get from environment variables
const CLASSIFIER_URL = process.env.CLASSIFIER_URL || process.env.AI_SERVICE_URL || 'https://digital-farmers-market-backend.vercel.app';
const CLASSIFIER_TIMEOUT = parseInt(process.env.CLASSIFIER_TIMEOUT) || 90000;
const MAX_RETRIES = parseInt(process.env.CLASSIFIER_MAX_RETRIES) || 5; // Increased to 5 retries
const BASE_DELAY = parseInt(process.env.CLASSIFIER_BASE_DELAY) || 3000; // 3 seconds base delay

// Throttling: Track last request time to ensure we don't exceed rate limits
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 3000; // Minimum 3 seconds between requests (adjustable)

class ImageClassifier {
    constructor() {
        this.classifierUrl = CLASSIFIER_URL;
        this.timeout = CLASSIFIER_TIMEOUT;
        this.maxRetries = MAX_RETRIES;
        this.baseDelay = BASE_DELAY;
        this.minRequestInterval = MIN_REQUEST_INTERVAL;
        console.log(`✅ Classifier initialized with URL: ${this.classifierUrl}`);
        console.log(`✅ Classifier timeout set to: ${this.timeout}ms`);
        console.log(`✅ Max retries: ${this.maxRetries}`);
        console.log(`✅ Base retry delay: ${this.baseDelay}ms`);
        console.log(`✅ Min request interval: ${this.minRequestInterval}ms`);
    }

    // Throttling: Wait if too many requests are being sent
    async throttleRequest() {
        const now = Date.now();
        const timeSinceLastRequest = now - lastRequestTime;
        
        if (timeSinceLastRequest < this.minRequestInterval) {
            const waitTime = this.minRequestInterval - timeSinceLastRequest;
            console.log(`⏳ Throttling: Waiting ${waitTime}ms before next request...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        lastRequestTime = Date.now();
    }

    async healthCheck() {
        try {
            console.log(`Checking classifier health at: ${this.classifierUrl}/classify/health`);
            const response = await axios.get(`${this.classifierUrl}/classify/health`, {
                timeout: 10000
            });
            console.log('Health check response:', response.data);
            return response.data;
        } catch (error) {
            console.error('Classifier health check failed:', error.message);
            return { status: 'unavailable', model_loaded: false };
        }
    }

    async classifyImage(imageBuffer, filename = 'image.jpg', retryCount = 0) {
        try {
            // Apply throttling before making the request
            await this.throttleRequest();

            const formData = new FormData();
            formData.append('image', imageBuffer, filename);

            console.log(`Calling classifier at: ${this.classifierUrl}/classify/predict`);
            console.log(`Timeout set to: ${this.timeout}ms`);
            
            const startTime = Date.now();
            const response = await axios.post(
                `${this.classifierUrl}/classify/predict`,
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                        'Accept': 'application/json'
                    },
                    timeout: this.timeout
                }
            );
            const duration = Date.now() - startTime;
            console.log(`✅ Classification completed in ${duration}ms`);

            console.log('Classification successful:', response.data);
            return response.data;
            
        } catch (error) {
            const isRateLimit = error.response?.status === 429;
            const isTimeout = error.code === 'ECONNABORTED';
            const isServerError = error.response?.status >= 500 && error.response?.status < 600;
            
            // Calculate delay with exponential backoff: 3s, 6s, 12s, 24s, 48s
            const delay = Math.pow(2, retryCount) * this.baseDelay;
            
            // Retry on rate limit (429), timeout, or server errors (5xx)
            if ((isRateLimit || isTimeout || isServerError) && retryCount < this.maxRetries) {
                console.warn(`⚠️ ${isRateLimit ? 'Rate limit (429)' : isTimeout ? 'Timeout' : `Server error (${error.response?.status})`} - Waiting ${delay/1000}s before retry... (Attempt ${retryCount + 1}/${this.maxRetries})`);
                
                // Wait before retrying with exponential backoff
                await new Promise(resolve => setTimeout(resolve, delay));
                
                // Retry the request
                return this.classifyImage(imageBuffer, filename, retryCount + 1);
            }
            
            // If we've exhausted retries or it's a different error, throw
            console.error('❌ Image classification failed:');
            console.error('  URL:', `${this.classifierUrl}/classify/predict`);
            console.error('  Status:', error.response?.status);
            console.error('  Response:', error.response?.data);
            console.error('  Message:', error.message);
            console.error('  Retry attempts made:', retryCount);
            
            if (isRateLimit) {
                throw new Error(`Rate limit exceeded after ${retryCount} retries. Please wait a moment and try again. The AI service is currently busy.`);
            }
            if (isTimeout) {
                throw new Error(`Classification timeout after ${this.timeout}ms. The AI service may be overloaded. Please try again.`);
            }
            throw new Error(`Classification failed: ${error.message}`);
        }
    }

    async classifyFromPath(imagePath) {
        const imageBuffer = fs.readFileSync(imagePath);
        return this.classifyImage(imageBuffer, path.basename(imagePath));
    }

    async getClasses() {
        try {
            const response = await axios.get(`${this.classifierUrl}/classify/classes`);
            return response.data;
        } catch (error) {
            console.error('Failed to get classes:', error.message);
            return { classes: [], count: 0 };
        }
    }
}

module.exports = new ImageClassifier();