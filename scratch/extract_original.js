const fs = require('fs');
const readline = require('readline');
const path = require('path');

const transcriptPath = 'C:\\Users\\dynast\\.gemini\\antigravity\\brain\\e3d8ca3d-02c9-40e3-82e0-746f7f7adfac\\.system_generated\\logs\\transcript.jsonl';

async function run() {
  const fileStream = fs.createReadStream(transcriptPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let originalContent = null;

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const step = JSON.parse(line);
      // We want to find the first view_file output for TeePublicDesignManager.jsx (e.g. step 447)
      if (step.step_index === 447 || step.step_index === 469) {
        if (step.type === 'VIEW_FILE' && step.status === 'DONE' && step.content) {
          console.log("Found VIEW_FILE step output at step:", step.step_index);
          originalContent = step.content;
          break;
        }
      }
    } catch (e) {
      // Ignored
    }
  }

  if (originalContent) {
    console.log("Successfully extracted original step output!");
    fs.writeFileSync(path.join(__dirname, 'extracted_teepublic.txt'), originalContent, 'utf8');
  } else {
    console.log("Could not find step 447/469 content in logs.");
  }
}

run();
