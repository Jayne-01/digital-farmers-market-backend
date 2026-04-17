const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');

// Get from environment variables
const CLASSIFIER_URL = process.env.CLASSIFIER_URL || 'http://localhost:5002';
const CLASSIFIER_TIMEOUT = parseInt(process.env.CLASSIFIER_TIMEOUT) || 30000;

class ImageClassifier {
    constructor() {
        this.classifierUrl = CLASSIFIER_URL;
        this.timeout = CLASSIFIER_TIMEOUT;
    }

    async healthCheck() {
        try {
            const response = await axios.get(`${this.classifierUrl}/classify/health`);
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

            const response = await axios.post(
                `${this.classifierUrl}/classify/predict`,
                formData,
                {
                    headers: formData.getHeaders(),
                    timeout: this.timeout
                }
            );

            return response.data;
        } catch (error) {
            console.error('Image classification failed:', error.message);
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