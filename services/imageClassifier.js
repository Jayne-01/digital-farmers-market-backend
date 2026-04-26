const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');

// Get from environment variables
const CLASSIFIER_URL = process.env.CLASSIFIER_URL || process.env.AI_SERVICE_URL || 'https://farm-classifier.onrender.com';
const CLASSIFIER_TIMEOUT = parseInt(process.env.CLASSIFIER_TIMEOUT) || 60000;
const MAX_RETRIES = parseInt(process.env.CLASSIFIER_MAX_RETRIES) || 3;

class ImageClassifier {
    constructor() {
        this.classifierUrl = CLASSIFIER_URL;
        this.timeout = CLASSIFIER_TIMEOUT;
        this.maxRetries = MAX_RETRIES;
        console.log(`✅ Classifier initialized with URL: ${this.classifierUrl}`);
        console.log(`✅ Classifier timeout set to: ${this.timeout}ms`);
        console.log(`✅ Max retries for rate limiting: ${this.maxRetries}`);
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
            console.log(`Classification completed in ${duration}ms`);

            console.log('Classification successful:', response.data);
            return response.data;
            
        } catch (error) {
            const isRateLimit = error.response?.status === 429;
            const isTimeout = error.code === 'ECONNABORTED';
            const isServerError = error.response?.status >= 500 && error.response?.status < 600;
            
            // Calculate delay with exponential backoff: 1s, 2s, 4s, 8s...
            const delay = Math.pow(2, retryCount) * 1000;
            
            // Retry on rate limit (429), timeout, or server errors (5xx)
            if ((isRateLimit || isTimeout || isServerError) && retryCount < this.maxRetries) {
                console.warn(`⚠️ ${isRateLimit ? 'Rate limit (429)' : isTimeout ? 'Timeout' : `Server error (${error.response?.status})`} - Retrying in ${delay}ms... (Attempt ${retryCount + 1}/${this.maxRetries})`);
                
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, delay));
                
                // Retry the request
                return this.classifyImage(imageBuffer, filename, retryCount + 1);
            }
            
            // If we've exhausted retries or it's a different error, throw
            console.error('Image classification failed:');
            console.error('  URL:', `${this.classifierUrl}/classify/predict`);
            console.error('  Status:', error.response?.status);
            console.error('  Response:', error.response?.data);
            console.error('  Message:', error.message);
            console.error('  Retry attempts made:', retryCount);
            
            if (isRateLimit) {
                throw new Error(`Rate limit exceeded after ${retryCount} retries. Please try again later.`);
            }
            if (isTimeout) {
                throw new Error(`Classification timeout after ${this.timeout}ms. The AI service may be busy. Please try again.`);
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