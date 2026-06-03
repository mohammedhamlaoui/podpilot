const fs = require('fs');

const logPath = 'C:\\Users\\dynast\\.gemini\\antigravity\\brain\\e25ae260-daec-450f-8221-cb01dba4e77b\\.system_generated\\logs\\transcript.jsonl';

if (!fs.existsSync(logPath)) {
  console.error("Log file does not exist.");
  process.exit(1);
}

const lines = fs.readFileSync(logPath, 'utf-8').split('\n');
console.log(`Checking ${lines.length} lines...`);

for (const line of lines) {
  if (!line.trim()) continue;
  try {
    const entry = JSON.parse(line);
    const hasTeepublic = JSON.stringify(entry).includes('content-teepublic.js');
    if (hasTeepublic) {
      console.log(`Step ${entry.step_index}: type=${entry.type} status=${entry.status}`);
      if (entry.tool_calls) {
        entry.tool_calls.forEach(tc => {
          console.log(`  Tool Call: ${tc.name}`);
        });
      }
    }
  } catch (e) {}
}
