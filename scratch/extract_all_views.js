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

  let fileParts = [];

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const step = JSON.parse(line);
      
      // Let's look at the result of view_file or tool output of view_file
      // We want to find the output content of view_file for TeePublicDesignManager.jsx
      if (step.tool_calls) {
        for (const tc of step.tool_calls) {
          if (tc.name === 'default_api:view_file' && tc.args && tc.args.AbsolutePath && tc.args.AbsolutePath.includes('TeePublicDesignManager.jsx')) {
            console.log("View_file call args:", tc.args);
          }
        }
      }
      
      if (step.type === 'VIEW_FILE' && step.status === 'DONE' && step.content && step.content.includes('TeePublicDesignManager.jsx')) {
        console.log("Found VIEW_FILE step output at step:", step.step_index);
        // Let's parse out lines and line numbers from step.content or step.output
      }

      // Check if output is present
      if (line.includes('TeePublicDesignManager.jsx') && line.includes('Showing lines')) {
        const parsed = JSON.parse(line);
        const output = parsed.output || parsed.content;
        if (output && output.includes('Showing lines')) {
          const match = output.match(/Showing lines (\d+) to (\d+)/);
          if (match) {
            const start = parseInt(match[1]);
            const end = parseInt(match[2]);
            console.log(`Found part: lines ${start} to ${end} in step ${parsed.step_index}`);
            // Let's parse the actual lines from the output
            const linesContent = output.split('\n');
            const parsedLines = [];
            for (const l of linesContent) {
              const lineMatch = l.match(/^\s*(\d+):\s(.*)/);
              if (lineMatch) {
                const lineNum = parseInt(lineMatch[1]);
                const lineCode = lineMatch[2];
                parsedLines.push({ lineNum, lineCode });
              }
            }
            fileParts.push({ start, end, parsedLines });
          }
        }
      }
    } catch (e) {
      // Ignored
    }
  }

  // Now, let's reconstruct the file by placing lines into an array
  const fullFileLines = new Array(2000).fill(null);
  
  // Sort parts by step order or just overlay them (later parts have our edits, earlier are original)
  // Let's overlay them in chronological order
  for (const part of fileParts) {
    for (const pl of part.parsedLines) {
      fullFileLines[pl.lineNum] = pl.lineCode;
    }
  }

  // Let's see if we have gaps
  let gapCount = 0;
  let lastValidLine = 0;
  for (let i = 1; i < fullFileLines.length; i++) {
    if (fullFileLines[i] !== null) {
      lastValidLine = i;
    } else if (lastValidLine > 0) {
      // This is a gap
      gapCount++;
    }
  }

  console.log(`Reconstructed up to line ${lastValidLine}. Total gaps: ${gapCount}`);

  // Write out the reconstructed file
  const reconstructedContent = fullFileLines.slice(1, lastValidLine + 1).map((l, idx) => {
    if (l === null) {
      return `// MISSING LINE ${idx + 1}`;
    }
    return l;
  }).join('\n');

  fs.writeFileSync(path.join(__dirname, 'reconstructed_teepublic.jsx'), reconstructedContent, 'utf8');
  console.log("Successfully wrote reconstructed_teepublic.jsx!");
}

run();
