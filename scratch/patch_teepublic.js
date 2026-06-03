const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../frontend/src/components/TeePublicDesignManager.jsx');
let content = fs.readFileSync(filePath, 'utf8');

// We want to find the corrupted block in TeePublicDesignManager.jsx
// It starts with:
//   const [createError, setCreateError] = useState("");
//   import {
//     TEEPUBLIC_ALL_PRODUCT_KEYS,
//
// and ends with:
//   const [createError, setCreateError] = useState("");
//
// Let's find "const [createError, setCreateError] = useState("");"
// The first one is the normal one. The second one is the start of the duplicated block.
// Wait, the corrupted block actually starts with:
// "import {\n  TEEPUBLIC_ALL_PRODUCT_KEYS," right after the first "const [createError, setCreateError] = useState(\"\");"
// Let's find "const [createError, setCreateError] = useState(\"\");\nimport {\n  TEEPUBLIC_ALL_PRODUCT_KEYS,"
// wait, the imports start at line 195.
// Let's write a robust patch that removes the range between the first "const [createError, setCreateError] = useState(\"\");"
// and the second "const [createError, setCreateError] = useState(\"\");" (excluding the first one, including the second one).

const searchStr = 'const [createError, setCreateError] = useState("");';
const firstIndex = content.indexOf(searchStr);
if (firstIndex === -1) {
  console.error("Could not find the first createError state!");
  process.exit(1);
}

const secondIndex = content.indexOf(searchStr, firstIndex + searchStr.length);
if (secondIndex === -1) {
  console.error("Could not find the second createError state (no corruption detected?!)");
  process.exit(1);
}

// We want to delete from firstIndex + searchStr.length to secondIndex + searchStr.length
// Let's check what is right after the second searchStr.
// It should be:
//   const [createUploadError, setCreateUploadError] = useState("");
//   ...
//   const [confirmDelete, setConfirmDelete] = useState(null);
// Let's verify that we delete the exact corrupted chunk.
const startIndex = firstIndex + searchStr.length;
const endIndex = secondIndex + searchStr.length;

let updatedContent = content.slice(0, startIndex) + content.slice(endIndex);

// Now, let's inject "const [isDeleting, setIsDeleting] = useState(false);" right after
// "const [confirmDelete, setConfirmDelete] = useState(null);"
const confirmDeleteStr = 'const [confirmDelete, setConfirmDelete] = useState(null);';
const confirmDeleteIndex = updatedContent.indexOf(confirmDeleteStr);
if (confirmDeleteIndex === -1) {
  console.error("Could not find confirmDelete in updated content!");
  process.exit(1);
}

const injectIndex = confirmDeleteIndex + confirmDeleteStr.length;
updatedContent = updatedContent.slice(0, injectIndex) + '\n  const [isDeleting, setIsDeleting] = useState(false);' + updatedContent.slice(injectIndex);

fs.writeFileSync(filePath, updatedContent, 'utf8');
console.log("Successfully patched and uncorrupted TeePublicDesignManager.jsx!");
