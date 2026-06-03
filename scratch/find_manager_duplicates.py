with open(r"c:\Users\dynast\Desktop\chofi bntk\my project autmation\frontend\src\components\TeePublicDesignManager.jsx", 'r', encoding='utf-8') as f:
    content = f.read()

# Let's count how many times common functions appear
funcs = [
    "function toggleCreateImage",
    "function moveCreateIndex",
    "async function saveCreatedDesigns",
    "async function saveDesign",
    "function getCreateImageById",
    "function updateCreateDraft"
]

for func in funcs:
    print(f"{func}: {content.count(func)}")
