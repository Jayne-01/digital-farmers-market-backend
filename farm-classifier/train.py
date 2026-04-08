import tensorflow as tf
from tensorflow.keras import layers, models
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.preprocessing.image import ImageDataGenerator
from tensorflow.keras.callbacks import EarlyStopping, ModelCheckpoint, ReduceLROnPlateau
import matplotlib.pyplot as plt
import numpy as np
import os
import json

IMG_SIZE = (224, 224)
BATCH_SIZE = 32
EPOCHS = 50
NUM_CLASSES = 5 
CLASS_NAMES = ['fruits', 'vegetables', 'crops', 'rice', 'unknown'] 

TRAIN_DIR = 'data/train'
VALIDATION_DIR = 'data/validation'
TEST_DIR = 'data/test'
MODEL_SAVE_PATH = 'models/farm_classifier.h5'

def create_data_generators():
    print("Creating data generators...")
    
    train_datagen = ImageDataGenerator(
        rescale=1./255,
        rotation_range=30,
        width_shift_range=0.2,
        height_shift_range=0.2,
        shear_range=0.2,
        zoom_range=0.2,
        horizontal_flip=True,
        fill_mode='nearest'
    )
    
    val_datagen = ImageDataGenerator(rescale=1./255)
    test_datagen = ImageDataGenerator(rescale=1./255)
    
    train_generator = train_datagen.flow_from_directory(
        TRAIN_DIR, target_size=IMG_SIZE, batch_size=BATCH_SIZE,
        class_mode='categorical', classes=CLASS_NAMES
    )
    
    validation_generator = val_datagen.flow_from_directory(
        VALIDATION_DIR, target_size=IMG_SIZE, batch_size=BATCH_SIZE,
        class_mode='categorical', classes=CLASS_NAMES
    )
    
    test_generator = test_datagen.flow_from_directory(
        TEST_DIR, target_size=IMG_SIZE, batch_size=BATCH_SIZE,
        class_mode='categorical', classes=CLASS_NAMES, shuffle=False
    )
    
    return train_generator, validation_generator, test_generator

def create_pretrained_model():
    print("Creating MobileNetV2 model...")
    
    base_model = tf.keras.applications.MobileNetV2(
        weights='imagenet', include_top=False, input_shape=(224, 224, 3)
    )
    base_model.trainable = False
    
    model = models.Sequential([
        base_model,
        layers.GlobalAveragePooling2D(),
        layers.Dense(512, activation='relu'),
        layers.Dropout(0.5),
        layers.Dense(256, activation='relu'),
        layers.Dropout(0.3),
        layers.Dense(NUM_CLASSES, activation='softmax')  # Now 5 classes
    ])
    
    return model

def train_model(model, train_generator, validation_generator):
    model.compile(
        optimizer=Adam(learning_rate=0.001),
        loss='categorical_crossentropy',
        metrics=['accuracy']
    )
    
    os.makedirs('models', exist_ok=True)
    
    callbacks = [
        EarlyStopping(monitor='val_loss', patience=10, restore_best_weights=True, verbose=1),
        ModelCheckpoint(MODEL_SAVE_PATH, monitor='val_accuracy', save_best_only=True, verbose=1),
        ReduceLROnPlateau(monitor='val_loss', factor=0.2, patience=5, min_lr=0.00001, verbose=1)
    ]
    
    print("\nStarting training...")
    history = model.fit(
        train_generator,
        steps_per_epoch=train_generator.samples // BATCH_SIZE,
        epochs=EPOCHS,
        validation_data=validation_generator,
        validation_steps=validation_generator.samples // BATCH_SIZE,
        callbacks=callbacks,
        verbose=1
    )
    
    return history

def plot_training_history(history):
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4))
    
    ax1.plot(history.history['accuracy'], label='Train Accuracy')
    ax1.plot(history.history['val_accuracy'], label='Validation Accuracy')
    ax1.set_title('Model Accuracy')
    ax1.set_xlabel('Epoch')
    ax1.set_ylabel('Accuracy')
    ax1.legend()
    ax1.grid(True)
    
    ax2.plot(history.history['loss'], label='Train Loss')
    ax2.plot(history.history['val_loss'], label='Validation Loss')
    ax2.set_title('Model Loss')
    ax2.set_xlabel('Epoch')
    ax2.set_ylabel('Loss')
    ax2.legend()
    ax2.grid(True)
    
    plt.tight_layout()
    plt.savefig('training_history.png')
    plt.show()

def evaluate_model(model, test_generator):
    print("\nEvaluating on test data...")
    test_loss, test_accuracy = model.evaluate(test_generator)
    print(f'Test Loss: {test_loss:.4f}')
    print(f'Test Accuracy: {test_accuracy:.4f}')
    
    predictions = model.predict(test_generator)
    predicted_classes = np.argmax(predictions, axis=1)
    true_classes = test_generator.classes
    
    from sklearn.metrics import classification_report
    print('\nClassification Report:')
    print(classification_report(true_classes, predicted_classes, target_names=CLASS_NAMES))
    
    return test_accuracy

def main():
    print("=" * 50)
    print("FARM IMAGE CLASSIFIER TRAINING")
    print("=" * 50)
    
    if not os.path.exists(TRAIN_DIR):
        print(f"\nError: Training directory '{TRAIN_DIR}' not found!")
        print("Please run split_data.py first to organize your images.")
        return
    
    print("\n[1/4] Loading data...")
    train_gen, val_gen, test_gen = create_data_generators()
    
    print(f"\nTraining samples: {train_gen.samples}")
    print(f"Validation samples: {val_gen.samples}")
    print(f"Test samples: {test_gen.samples}")
    print(f"Classes: {CLASS_NAMES}")
    
    print("\n[2/4] Creating model...")
    model = create_pretrained_model()
    model.summary()
    
    print("\n[3/4] Training model...")
    history = train_model(model, train_gen, val_gen)
    
    plot_training_history(history)
    
    print("\n[4/4] Evaluating model...")
    test_accuracy = evaluate_model(model, test_gen)
    
    model.save(MODEL_SAVE_PATH)
    print(f"\n✓ Model saved to {MODEL_SAVE_PATH}")
    
    with open('models/class_names.json', 'w') as f:
        json.dump(CLASS_NAMES, f)
    print("✓ Class names saved to models/class_names.json")
    
    print("\n" + "=" * 50)
    print("TRAINING COMPLETE!")
    print(f"Final Test Accuracy: {test_accuracy:.2%}")
    print("=" * 50)

if __name__ == "__main__":
    main()