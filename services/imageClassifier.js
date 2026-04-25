const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');

// Get from environment variables - FIXED to use correct variable name
const CLASSIFIER_URL = process.env.CLASSIFIER_URL || process.env.AI_SERVICE_URL || 'https://farm-classifier.onrender.com';
const CLASSIFIER_TIMEOUT = parseInt(process.env.CLASSIFIER_TIMEOUT) || 60000;

class ImageClassifier {
    constructor() {
        this.classifierUrl = CLASSIFIER_URL;
        this.timeout = CLASSIFIER_TIMEOUT;
        console.log(`✅ Classifier initialized with URL: ${this.classifierUrl}`);
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

    async classifyImage(imageBuffer, filename = 'image.jpg') {
        try {
            const formData = new FormData();
            formData.append('image', imageBuffer, filename);

            console.log(`Calling classifier at: ${this.classifierUrl}/classify/predict`);
            
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

            console.log('Classification successful:', response.data);
            return response.data;
        } catch (error) {
            console.error('Image classification failed:');
            console.error('  URL:', `${this.classifierUrl}/classify/predict`);
            console.error('  Status:', error.response?.status);
            console.error('  Response:', error.response?.data);
            console.error('  Message:', error.message);
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