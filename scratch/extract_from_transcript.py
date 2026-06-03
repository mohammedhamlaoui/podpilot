import os
import json

appdata = r"C:\Users\dynast\.gemini\antigravity\brain"
conv_id = "7ff507d1-27a0-4360-bde8-c9a251273687"
transcript_path = os.path.join(appdata, conv_id, ".system_generated", "logs", "transcript.jsonl")

# We want to find the last step where view_file was called on TeePublicDesignManager.jsx and returned a successful complete file.
# Wait, let's look at steps. If a step type is VIEW_FILE and status is DONE, let's inspect the output.
last_content = None

with open(transcript_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            step = json.loads(line)
            # Check if this step is a tool response for view_file
            if step.get("type") == "VIEW_FILE" and step.get("status") == "DONE":
                # Let's check if the file path is TeePublicDesignManager.jsx
                if "TeePublicDesignManager.jsx" in step.get("content", ""):
                    # Let's extract the actual content from step["content"]
                    last_content = step.get("content")
                    print("Found a view_file output in transcript step:", step.get("step_index"))
            # Or check if it is a tool call or standard tool execution
            tool_calls = step.get("tool_calls", [])
            # Also check if it's step output from the system
            if step.get("source") == "SYSTEM" and "TeePublicDesignManager.jsx" in str(step.get("content", "")):
                # Wait, let's look for complete files
                if "The above content shows the entire, complete file contents" in str(step.get("content", "")):
                    last_content = step.get("content")
                    print("Found complete file in transcript step:", step.get("step_index"))
        except Exception as e:
            pass

if last_content:
    print("Successfully found a content block in transcript. Let's parse it.")
    # The view_file output has lines prefixed with <line_number>: <original_line>
    # Let's strip this formatting to get the original code!
    lines = last_content.split('\n')
    original_lines = []
    for line in lines:
        if ': ' in line:
            parts = line.split(': ', 1)
            # Check if the part before colon is a digit
            if parts[0].strip().isdigit():
                original_lines.append(parts[1])
    
    restored_code = '\n'.join(original_lines)
    print("Parsed restored code size:", len(restored_code))
    
    # Save the restored file to scratch
    restored_path = r"c:\Users\dynast\Desktop\chofi bntk\my project autmation\scratch\restored_TeePublicDesignManager.jsx"
    with open(restored_path, 'w', encoding='utf-8') as outf:
        outf.write(restored_code)
    print("Restored code saved to:", restored_path)
else:
    print("No complete content found in transcript.")
