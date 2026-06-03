styles_path = r"c:\Users\dynast\Desktop\chofi bntk\my project autmation\frontend\src\components\TeePublicDesignManager.jsx"

with open(styles_path, 'r', encoding='utf-8') as f:
    content = f.read()

print("Content length:", len(content))
# Let's print from pos 16800 to pos 20500
# Wait, let's write it to a file in scratch instead so it doesn't clutter or fail to print
with open(r"c:\Users\dynast\Desktop\chofi bntk\my project autmation\scratch\inspected_segment.txt", 'w', encoding='utf-8') as f:
    f.write(content[16500:23000])

print("Inspected segment written to scratch.")
