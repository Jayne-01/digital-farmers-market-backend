import tensorflow as tf
import numpy as np
from tensorflow.keras.preprocessing import image
import json
import os

class FarmImageClassifier:
    def __init__(self, model_path='models/farm_classifier.h5', class_names_path='models/class_names.json'):
        print("Loading model...")
        
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Model not found at {model_path}. Please train the model first.")
        
        self.model = tf.keras.models.load_model(model_path)
        
        if os.path.exists(class_names_path):
            with open(class_names_path, 'r') as f:
                self.class_names = json.load(f)
        else:
            self.class_names = ['fruits', 'vegetables', 'crops', 'rice']
        
        self.img_size = (224, 224)
        print(f"Model loaded successfully! Classes: {self.class_names}")
    
    def preprocess_image(self, img_path):
        img = image.load_img(img_path, target_size=self.img_size)
        img_array = image.img_to_array(img)
        img_array = img_array / 255.0
        img_array = np.expand_dims(img_array, axis=0)
        return img_array
    
    def predict(self, img_path):
        if not os.path.exists(img_path):
            raise FileNotFoundError(f"Image not found: {img_path}")
        
        img_array = self.preprocess_image(img_path)
        predictions = self.model.predict(img_array, verbose=0)[0]
        
        predicted_class_idx = np.argmax(predictions)
        predicted_class = self.class_names[predicted_class_idx]
        confidence = float(predictions[predicted_class_idx])
        
        results = {}
        for i, class_name in enumerate(self.class_names):
            results[class_name] = float(predictions[i])
        
        return {
            'predicted_class': predicted_class,
            'confidence': confidence,
            'all_probabilities': results
        }

if __name__ == "__main__":
    try:
        classifier = FarmImageClassifier()
        print("\nClassifier ready for predictions!")
    except Exception as e:
        print(f"Error: {e}")