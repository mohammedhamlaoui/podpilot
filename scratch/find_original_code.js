const fs = require('fs');
const path = require('path');

const logPath = 'C:\\Users\\dynast\\.gemini\\antigravity\\brain\\e25ae260-daec-450f-8221-cb01dba4e77b\\.system_generated\\logs\\transcript.jsonl';

if (!fs.existsSync(logPath)) {
  console.error("Log file does not exist at:", logPath);
  process.exit(1);
}

const lines = fs.readFileSync(logPath, 'utf-8').split('\n');
console.log(`Read ${lines.length} lines from transcript.`);

// Let's find entries with write_to_file or replace_file_content or containing code snippets
for (let i = lines.length - 1; i >= 0; i--) {
  const line = lines[i].trim();
  if (!line) continue;
  try {
    const entry = JSON.parse(line);
    // Ignore this step (274) or step index >= 270
    if (entry.step_index >= 270) continue;

    // Look for tool calls to replace_file_content or write_to_file
    if (entry.tool_calls) {
      for (const call of entry.tool_calls) {
        if (call.name === 'replace_file_content' || call.name === 'write_to_file' || call.name === 'multi_replace_file_content') {
          const argsStr = JSON.stringify(call.args);
          if (argsStr.includes('selectDdslickColor') && argsStr.includes('publishDesign')) {
            console.log(`Found relevant tool call at step index ${entry.step_index}, tool: ${call.name}`);
            console.log("Arguments preview:", argsStr.slice(0, 500));
            fs.writeFileSync('scratch_found_tool_args.json', JSON.stringify(call.args, null, 2), 'utf-8');
            console.log("Saved full tool arguments to scratch_found_tool_args.json");
            process.exit(0);
          }
        }
      }
    }
    // Also look for view_file outputs showing the original file contents
    if (entry.type === 'VIEW_FILE' && entry.status === 'DONE' && entry.content) {
      if (entry.content.includes('selectDdslickColor') && entry.content.includes('publishDesign')) {
        console.log(`Found relevant VIEW_FILE content at step index ${entry.step_index}`);
        fs.writeFileSync('scratch_found_view_file.txt', entry.content, 'utf-8');
        console.log("Saved content to scratch_found_view_file.txt");
        process.exit(0);
      }
    }
  } catch (e) {
    // ignore malformed lines
  }
}

console.log("Could not find any entry with selectDdslickColor and publishDesign.");
