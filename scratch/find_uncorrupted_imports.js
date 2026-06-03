const fs = require('fs');
const readline = require('readline');

const transcriptPath = 'C:\\Users\\dynast\\.gemini\\antigravity\\brain\\e3d8ca3d-02c9-40e3-82e0-746f7f7adfac\\.system_generated\\logs\\transcript.jsonl';

async function run() {
  const fileStream = fs.createReadStream(transcriptPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const step = JSON.parse(line);
      if (step.step_index === 687 && step.type === 'VIEW_FILE' && step.status === 'DONE' && step.content) {
        console.log("Step 687 VIEW_FILE content:\n", step.content);
        break;
      }
    } catch (e) {}
  }
}

run();
