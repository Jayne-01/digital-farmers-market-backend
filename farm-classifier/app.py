from flask import Flask, request, jsonify
from flask_cors import CORS
import os
from werkzeug.utils import secure_filename
import tensorflow as tf
import numpy as np
from tensorflow.keras.preprocessing import image
import json
import io
from PIL import Image
import base64

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp'}

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Model paths
MODEL_PATH = 'models/farm_classifier.h5'
CLASS_NAMES_PATH = 'models/class_names.json'

# Load model
model = None
class_names = ['fruits', 'vegetables', 'crops', 'rice']
model_loaded = False

try:
    if os.path.exists(MODEL_PATH):
        model = tf.keras.models.load_model(MODEL_PATH)
        model_loaded = True
        print("✓ Model loaded successfully!")
    else:
        print(f"⚠️ Model not found at {MODEL_PATH}")
    
    if os.path.exists(CLASS_NAMES_PATH):
        with open(CLASS_NAMES_PATH, 'r') as f:
            class_names = json.load(f)
    print(f"✓ Classes: {class_names}")
except Exception as e:
    print(f"⚠️ Error loading model: {e}")

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def preprocess_image(img_path):
    """Preprocess image for model prediction"""
    img = image.load_img(img_path, target_size=(224, 224))
    img_array = image.img_to_array(img)
    img_array = img_array / 255.0
    img_array = np.expand_dims(img_array, axis=0)
    return img_array

def predict_from_array(img_array):
    """Make prediction from preprocessed array"""
    if model is None:
        return None, 0, {}
    
    predictions = model.predict(img_array, verbose=0)[0]
    predicted_idx = np.argmax(predictions)
    predicted_class = class_names[predicted_idx]
    confidence = float(predictions[predicted_idx])
    
    all_probabilities = {}
    for i, class_name in enumerate(class_names):
        all_probabilities[class_name] = float(predictions[i])
    
    return predicted_class, confidence, all_probabilities

@app.route('/classify/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy', 
        'model_loaded': model_loaded,
        'classes': class_names
    })

@app.route('/classify/predict', methods=['POST'])
def predict_image():
    """Predict image category from file upload"""
    if not model_loaded:
        return jsonify({'error': 'Model not loaded. Please train the model first.'}), 503
    
    # Check for file upload
    if 'image' not in request.files:
        return jsonify({'error': 'No image file provided'}), 400
    
    file = request.files['image']
    
    if file.filename == '':
        return jsonify({'error': 'No image selected'}), 400
    
    if not allowed_file(file.filename):
        return jsonify({'error': 'File type not allowed. Allowed: png, jpg, jpeg, gif, bmp'}), 400
    
    try:
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        img_array = preprocess_image(filepath)
        predicted_class, confidence, all_probabilities = predict_from_array(img_array)
        
        os.remove(filepath)
        
        # Return confidence as percentage (0-100)
        confidence_percent = round(confidence * 100, 2)
        
        return jsonify({
            'success': True,
            'prediction': predicted_class,
            'confidence': confidence_percent,
            'probabilities': {k: round(v * 100, 2) for k, v in all_probabilities.items()}
        })
        
    except Exception as e:
        # Clean up if file exists
        if 'filepath' in locals() and os.path.exists(filepath):
            os.remove(filepath)
        return jsonify({'error': str(e)}), 500

@app.route('/classify/predict-base64', methods=['POST'])
def predict_base64():
    """Predict image category from base64 string"""
    if not model_loaded:
        return jsonify({'error': 'Model not loaded. Please train the model first.'}), 503
    
    data = request.get_json()
    
    if not data or 'image' not in data:
        return jsonify({'error': 'No image data provided'}), 400
    
    try:
        # Decode base64 image
        image_data = data['image']
        if ',' in image_data:
            image_data = image_data.split(',')[1]
        
        img_bytes = base64.b64decode(image_data)
        img = Image.open(io.BytesIO(img_bytes))
        
        # Convert to RGB if needed
        if img.mode != 'RGB':
            img = img.convert('RGB')
        
        # Save temporarily
        filename = f"temp_{os.urandom(8).hex()}.jpg"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        img.save(filepath)
        
        img_array = preprocess_image(filepath)
        predicted_class, confidence, all_probabilities = predict_from_array(img_array)
        
        os.remove(filepath)
        
        # Return confidence as percentage (0-100)
        confidence_percent = round(confidence * 100, 2)
        
        return jsonify({
            'success': True,
            'prediction': predicted_class,
            'confidence': confidence_percent,
            'probabilities': {k: round(v * 100, 2) for k, v in all_probabilities.items()}
        })
        
    except Exception as e:
        if 'filepath' in locals() and os.path.exists(filepath):
            os.remove(filepath)
        return jsonify({'error': str(e)}), 500

@app.route('/classify/classes', methods=['GET'])
def get_classes():
    return jsonify({'classes': class_names, 'count': len(class_names)})

if __name__ == '__main__':
    print("=" * 50)
    print("FARM IMAGE CLASSIFIER API")
    print("=" * 50)
    print(f"Model loaded: {model_loaded}")
    print(f"Classes: {class_names}")
    print("\nStarting server on http://localhost:5002")
    print("Endpoints:")
    print("  GET  /classify/health       - Health check")
    print("  GET  /classify/classes      - Get available classes")
    print("  POST /classify/predict      - Predict from file upload")
    print("  POST /classify/predict-base64 - Predict from base64")
    print("=" * 50)
    app.run(debug=True, port=5002, host='0.0.0.0')