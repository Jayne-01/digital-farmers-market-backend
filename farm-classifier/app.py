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
import tempfile

app = Flask(__name__)
CORS(app)

# ============= CONFIGURATION =============
# Use /tmp for Vercel serverless environment
UPLOAD_FOLDER = '/tmp/uploads'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp'}

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# ============= LOAD MODEL =============
model = None
class_names = ['fruits', 'vegetables', 'crops', 'rice']
model_loaded = False

# Optimize TensorFlow for serverless environment
tf.config.threading.set_intra_op_parallelism_threads(1)
tf.config.threading.set_inter_op_parallelism_threads(1)

# Get model paths - try multiple locations for Vercel
MODEL_PATHS = [
    'models/farm_classifier.h5',
    'model/farm_classifier.h5',
    'farm_classifier.h5',
    '/tmp/models/farm_classifier.h5'
]

CLASS_NAMES_PATHS = [
    'models/class_names.json',
    'model/class_names.json',
    'class_names.json',
    '/tmp/models/class_names.json'
]

def load_model_and_classes():
    global model, class_names, model_loaded
    
    # Load class names
    for class_path in CLASS_NAMES_PATHS:
        if os.path.exists(class_path):
            try:
                with open(class_path, 'r') as f:
                    class_names = json.load(f)
                print(f"✓ Class names loaded from {class_path}")
                break
            except Exception as e:
                print(f"⚠️ Error loading class names from {class_path}: {e}")
    
    # Load model
    for model_path in MODEL_PATHS:
        if os.path.exists(model_path):
            try:
                model = tf.keras.models.load_model(model_path)
                model_loaded = True
                print(f"✓ Model loaded successfully from {model_path}")
                return
            except Exception as e:
                print(f"⚠️ Error loading model from {model_path}: {e}")
    
    if not model_loaded:
        print("⚠️ No model found. Running in demo mode.")

# Load model on startup
load_model_and_classes()

# ============= HELPER FUNCTIONS =============
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
        # Demo mode - return mock prediction
        return 'rice', 85.5, {c: 25.0 for c in class_names}
    
    predictions = model.predict(img_array, verbose=0)[0]
    predicted_idx = np.argmax(predictions)
    predicted_class = class_names[predicted_idx]
    confidence = float(predictions[predicted_idx]) * 100
    
    all_probabilities = {}
    for i, class_name in enumerate(class_names):
        all_probabilities[class_name] = float(predictions[i]) * 100
    
    return predicted_class, confidence, all_probabilities

# ============= ROUTES =============
@app.route('/', methods=['GET'])
def home():
    return jsonify({
        'service': 'Farm Image Classifier API',
        'status': 'running',
        'model_loaded': model_loaded,
        'demo_mode': model is None,
        'endpoints': {
            'health': '/classify/health',
            'predict': '/classify/predict (POST)',
            'predict_base64': '/classify/predict-base64 (POST)',
            'classes': '/classify/classes'
        }
    })

@app.route('/classify/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'model_loaded': model_loaded,
        'classes': class_names,
        'demo_mode': model is None
    })

@app.route('/classify/predict', methods=['POST', 'OPTIONS'])
def predict_image():
    """Predict image category from file upload"""
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    
    if model is None:
        return jsonify({
            'success': True,
            'prediction': 'rice',
            'confidence': 85.5,
            'demo_mode': True,
            'message': 'Demo mode - Model not loaded, returning mock prediction'
        })
    
    # Check for file upload
    if 'image' not in request.files:
        return jsonify({'error': 'No image file provided'}), 400
    
    file = request.files['image']
    
    if file.filename == '':
        return jsonify({'error': 'No image selected'}), 400
    
    if not allowed_file(file.filename):
        return jsonify({'error': f'File type not allowed. Allowed: {", ".join(ALLOWED_EXTENSIONS)}'}), 400
    
    filepath = None
    try:
        # Save to temporary file
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        # Preprocess and predict
        img_array = preprocess_image(filepath)
        predicted_class, confidence, all_probabilities = predict_from_array(img_array)
        
        return jsonify({
            'success': True,
            'prediction': predicted_class,
            'confidence': round(confidence, 2),
            'probabilities': {k: round(v, 2) for k, v in all_probabilities.items()}
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
    finally:
        # Clean up temp file
        if filepath and os.path.exists(filepath):
            try:
                os.remove(filepath)
            except:
                pass

@app.route('/classify/predict-base64', methods=['POST', 'OPTIONS'])
def predict_base64():
    """Predict image category from base64 string"""
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    
    if model is None:
        return jsonify({
            'success': True,
            'prediction': 'rice',
            'confidence': 85.5,
            'demo_mode': True,
            'message': 'Demo mode - Model not loaded, returning mock prediction'
        })
    
    data = request.get_json()
    
    if not data or 'image' not in data:
        return jsonify({'error': 'No image data provided'}), 400
    
    filepath = None
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
        
        # Save to temporary file using tempfile
        with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False, dir=UPLOAD_FOLDER) as tmp:
            filepath = tmp.name
            img.save(filepath)
        
        img_array = preprocess_image(filepath)
        predicted_class, confidence, all_probabilities = predict_from_array(img_array)
        
        return jsonify({
            'success': True,
            'prediction': predicted_class,
            'confidence': round(confidence, 2),
            'probabilities': {k: round(v, 2) for k, v in all_probabilities.items()}
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
    finally:
        # Clean up temp file
        if filepath and os.path.exists(filepath):
            try:
                os.remove(filepath)
            except:
                pass

@app.route('/classify/classes', methods=['GET'])
def get_classes():
    return jsonify({
        'classes': class_names,
        'count': len(class_names),
        'model_loaded': model_loaded
    })

# ============= VERCEL HANDLER =============
# This is required for Vercel serverless deployment
def handler(request, context):
    """Vercel serverless function handler"""
    return app(request.environ, lambda x, y: None)

# ============= MAIN =============
if __name__ == '__main__':
    print("=" * 50)
    print("FARM IMAGE CLASSIFIER API")
    print("=" * 50)
    print(f"Model loaded: {model_loaded}")
    print(f"Classes: {class_names}")
    print(f"Server: http://0.0.0.0:5002")
    print("=" * 50)
    app.run(debug=False, port=5002, host='0.0.0.0')