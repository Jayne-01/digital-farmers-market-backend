const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticateToken } = require('../middleware/authMiddleware');
const imageClassifier = require('../services/imageClassifier');

// Configure multer for memory storage (no disk storage)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only images are allowed.'));
        }
    }
});

// Health check endpoint (public)
router.get('/classifier/health', async (req, res) => {
    try {
        const health = await imageClassifier.healthCheck();
        res.json(health);
    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({ 
            status: 'error', 
            model_loaded: false,
            error: error.message 
        });
    }
});

// Get available classes (public)
router.get('/classifier/classes', async (req, res) => {
    try {
        const classes = await imageClassifier.getClasses();
        res.json(classes);
    } catch (error) {
        console.error('Get classes error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Classify a single image (authenticated)
router.post('/classify', authenticateToken, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                error: 'No image file provided' 
            });
        }

        const result = await imageClassifier.classifyImage(
            req.file.buffer, 
            req.file.originalname
        );
        
        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('Classification error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Classify multiple images (authenticated)
router.post('/classify/batch', authenticateToken, upload.array('images', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'No image files provided' 
            });
        }

        const results = [];
        for (const file of req.files) {
            try {
                const result = await imageClassifier.classifyImage(
                    file.buffer, 
                    file.originalname
                );
                results.push({
                    filename: file.originalname,
                    success: true,
                    prediction: result.prediction,
                    confidence: result.confidence,
                    probabilities: result.probabilities
                });
            } catch (error) {
                results.push({
                    filename: file.originalname,
                    success: false,
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            results
        });
    } catch (error) {
        console.error('Batch classification error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Validate product image matches its category (authenticated)
router.post('/validate-product', authenticateToken, upload.single('image'), async (req, res) => {
    try {
        const { expectedCategory } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                error: 'No image file provided' 
            });
        }
        
        if (!expectedCategory) {
            return res.status(400).json({ 
                success: false, 
                error: 'Expected category is required' 
            });
        }

        const result = await imageClassifier.classifyImage(
            req.file.buffer, 
            req.file.originalname
        );
        
        const isValid = result.prediction.toLowerCase() === expectedCategory.toLowerCase();
        
        res.json({
            success: true,
            isValid: isValid,
            predicted: result.prediction,
            expected: expectedCategory,
            confidence: result.confidence,
            probabilities: result.probabilities,
            message: isValid 
                ? `Image validated: ${result.prediction} (${result.confidence}% confidence)` 
                : `Image validation failed. Expected ${expectedCategory} but got ${result.prediction}`
        });
    } catch (error) {
        console.error('Product validation error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Get model information (public)
router.get('/classifier/model-info', async (req, res) => {
    try {
        const classes = await imageClassifier.getClasses();
        res.json({
            input_shape: [224, 224, 3],
            classes: classes.classes,
            num_classes: classes.count,
            model_type: 'MobileNetV2 Transfer Learning'
        });
    } catch (error) {
        console.error('Model info error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

module.exports = router;