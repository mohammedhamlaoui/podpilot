styles_path = r"c:\Users\dynast\Desktop\chofi bntk\my project autmation\frontend\src\styles.css"

with open(styles_path, 'rb') as f:
    content = f.read()

# Let's count newline chars
print("Count of \\r\\n:", content.count(b'\r\n'))
print("Count of \\n:", content.count(b'\n'))
print("Count of \\r:", content.count(b'\r'))
print("Count of \\r\\r\\n:", content.count(b'\r\r\n'))
print("Count of \\n\\r\\n:", content.count(b'\n\r\n'))
print("Count of \\n\\n:", content.count(b'\n\n'))
