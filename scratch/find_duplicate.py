styles_path = r"c:\Users\dynast\Desktop\chofi bntk\my project autmation\frontend\src\styles.css"

with open(styles_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Let's count how many times common CSS classes appear
print("Count of .pp-app:", content.count(".pp-app"))
print("Count of .pp-sidebar:", content.count(".pp-sidebar"))
print("Count of .landing-tokens-grid:", content.count(".landing-tokens-grid"))
print("Count of .marketplace-import:", content.count(".marketplace-import"))
