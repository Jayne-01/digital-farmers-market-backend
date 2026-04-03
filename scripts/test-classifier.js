const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

const API_URL = 'http://localhost:5000'; // Your main backend
const TOKEN = 'YOUR_AUTH_TOKEN_HERE'; // Replace with actual token

async function testClassifier() {
    try {
        // Test health check
        console.log('Testing classifier health...');
        const health = await axios.get(`${API_URL}/api/classifier/health`);
        console.log('Health:', health.data);

        // Test with a sample image
        console.log('\nTesting image classification...');
        const formData = new FormData();
        formData.append('image', fs.createReadStream('data/test/fruits/your_image.jpg'));

        const result = await axios.post(`${API_URL}/api/classify`, formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${TOKEN}`
            }
        });
        
        console.log('Classification result:', result.data);
        
    } catch (error) {
        console.error('Error:', error.response?.data || error.message);
    }
}

testClassifier();