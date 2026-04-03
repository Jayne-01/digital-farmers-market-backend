import os
import random
import shutil
import json

def split_data(source_dir='data/raw', train_dir='data/train', 
               val_dir='data/validation', test_dir='data/test',
               train_ratio=0.7, val_ratio=0.15, test_ratio=0.15):
    
    print("=" * 50)
    print("SPLITTING DATASET")
    print("=" * 50)
    
    if not os.path.exists(source_dir):
        print(f"\nError: Source directory '{source_dir}' not found!")
        print("Please create the following structure:")
        print(f"  {source_dir}/")
        print("    ├── fruits/")
        print("    ├── vegetables/")
        print("    ├── crops/")
        print("    └── rice/")
        return
    
    for dir_path in [train_dir, val_dir, test_dir]:
        os.makedirs(dir_path, exist_ok=True)
    
    categories = [d for d in os.listdir(source_dir) 
                  if os.path.isdir(os.path.join(source_dir, d))]
    
    print(f"\nFound categories: {categories}")
    stats = {}
    
    for category in categories:
        category_path = os.path.join(source_dir, category)
        images = [f for f in os.listdir(category_path) 
                  if f.lower().endswith(('.jpg', '.jpeg', '.png', '.gif', '.bmp'))]
        
        if len(images) == 0:
            print(f"Warning: No images found in {category}")
            continue
        
        random.shuffle(images)
        
        total = len(images)
        train_count = int(total * train_ratio)
        val_count = int(total * val_ratio)
        test_count = total - train_count - val_count
        
        stats[category] = {'total': total, 'train': train_count, 'val': val_count, 'test': test_count}
        
        os.makedirs(os.path.join(train_dir, category), exist_ok=True)
        os.makedirs(os.path.join(val_dir, category), exist_ok=True)
        os.makedirs(os.path.join(test_dir, category), exist_ok=True)
        
        for i, img in enumerate(images):
            src = os.path.join(category_path, img)
            if i < train_count:
                dst = os.path.join(train_dir, category, img)
            elif i < train_count + val_count:
                dst = os.path.join(val_dir, category, img)
            else:
                dst = os.path.join(test_dir, category, img)
            shutil.copy2(src, dst)
        
        print(f"\n{category.upper()}:")
        print(f"  Total: {total} images")
        print(f"  Train: {train_count}")
        print(f"  Validation: {val_count}")
        print(f"  Test: {test_count}")
    
    print("\n" + "=" * 50)
    print("DATA SPLIT COMPLETE!")
    print("=" * 50)
    
    with open('split_stats.json', 'w') as f:
        json.dump(stats, f, indent=2)
    print("\nSplit statistics saved to split_stats.json")

if __name__ == "__main__":
    split_data()