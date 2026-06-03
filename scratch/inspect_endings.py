styles_path = r"c:\Users\dynast\Desktop\chofi bntk\my project autmation\frontend\src\styles.css"

with open(styles_path, 'rb') as f:
    content = f.read()

# Let's inspect the first 200 bytes
print("First 200 bytes:", content[:200])
