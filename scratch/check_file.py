import sys
sys.stdout.reconfigure(encoding='utf-8')

styles_path = r"c:\Users\dynast\Desktop\chofi bntk\my project autmation\frontend\src\styles.css"

with open(styles_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

print(f"Total lines: {len(lines)}")
for idx, line in enumerate(lines[:30]):
    print(f"{idx+1}: {line}", end='')
