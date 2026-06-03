const fs = require('fs');

const logPath = 'C:\\Users\\dynast\\.gemini\\antigravity\\brain\\e25ae260-daec-450f-8221-cb01dba4e77b\\.system_generated\\logs\\transcript.jsonl';
const targetFile = 'c:\\Users\\dynast\\Desktop\\chofi bntk\\my project autmation\\extension\\content-teepublic.js';

if (!fs.existsSync(logPath)) {
  console.error("Log file does not exist at:", logPath);
  process.exit(1);
}

const lines = fs.readFileSync(logPath, 'utf-8').split('\n');
let originalContent = null;

for (const line of lines) {
  if (!line.trim()) continue;
  try {
    const entry = JSON.parse(line);
    if (entry.step_index === 262 && entry.content) {
      originalContent = entry.content;
      break;
    }
  } catch (e) {}
}

if (!originalContent) {
  console.error("Could not find step_index 262 in log.");
  process.exit(1);
}

// Extract the lines from originalContent.
// The format has lines prefixed like "1500: ..." or "1500: \r\n"
const originalLines = [];
const linesOfView = originalContent.split('\n');
for (const line of linesOfView) {
  const match = line.match(/^\d+:\s?(.*)$/);
  if (match) {
    originalLines.push(match[1].replace(/\r$/, ''));
  }
}

const restoredText = originalLines.join('\n');
console.log("Extracted original text lines 1500 to 1637:");
console.log(restoredText.slice(0, 300));

// Let's read the current content of content-teepublic.js
let currentContent = fs.readFileSync(targetFile, 'utf-8');

// We want to replace the messed up portion. Let's see what is inside content-teepublic.js between "  async function configureProducts(design) {" and "  async function runUpload(design) {"
const startMarker = '  async function configureProducts(design) {';
const endMarker = '  // ─── Main Upload Pipeline ───────────────────────────────────────────────────';

const startIndex = currentContent.indexOf(startMarker);
const endIndex = currentContent.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error("Could not find configureProducts or runUpload in the file.");
  process.exit(1);
}

// Let's replace everything from the start of configureProducts to the end of selectDdslickColor
// Wait! Let's get the original configureProducts + selectDdslickColor from the log content!
// Let's print out what we found
fs.writeFileSync('scratch_restored_lines.js', restoredText, 'utf-8');
console.log("Saved restored text to scratch_restored_lines.js");
