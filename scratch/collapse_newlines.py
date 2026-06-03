styles_path = r"c:\Users\dynast\Desktop\chofi bntk\my project autmation\frontend\src\styles.css"

with open(styles_path, 'rb') as f:
    content = f.read()

# Let's clean up double spacing
# First replace the bad \r\n\r\n or \n\r\n to just \r\n
cleaned = content.replace(b'\n\r\n', b'\n')
cleaned = cleaned.replace(b'\r\n\r\n', b'\r\n')

print(f"Original size: {len(content)}")
print(f"Cleaned size: {len(cleaned)}")

with open(styles_path, 'wb') as f:
    f.write(cleaned)

print("Collapse complete.")
