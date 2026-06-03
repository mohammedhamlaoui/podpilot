const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../frontend/src/components/TeePublicDesignManager.jsx');
let content = fs.readFileSync(filePath, 'utf8');

const lines = content.split('\n');
console.log("Original total lines:", lines.length);

// We want to delete 1-indexed lines 1764 to 1959 inclusive.
// That is 0-indexed indices 1763 to 1958.
const startIdx = 1763;
const endIdx = 1958;

const countToDelete = endIdx - startIdx + 1;
console.log(`Deleting ${countToDelete} lines starting from index ${startIdx} ("${lines[startIdx].trim()}") to ${endIdx} ("${lines[endIdx].trim()}")`);

lines.splice(startIdx, countToDelete);

console.log("New total lines:", lines.length);

fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
console.log("Successfully cleaned up TeePublicDesignManager.jsx!");
