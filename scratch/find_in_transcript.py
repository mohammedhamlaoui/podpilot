import os
import json

appdata = r"C:\Users\dynast\.gemini\antigravity\brain"
conv_id = "7ff507d1-27a0-4360-bde8-c9a251273687"
transcript_path = os.path.join(appdata, conv_id, ".system_generated", "logs", "transcript.jsonl")

if not os.path.exists(transcript_path):
    print("Transcript not found at:", transcript_path)
    # let's search parent folders
    parent = os.path.dirname(transcript_path)
    if os.path.exists(parent):
        print("Files in logs:", os.listdir(parent))
else:
    print("Transcript found! Size:", os.path.getsize(transcript_path))
    # Let's read it to find the last view_file of TeePublicDesignManager.jsx or any full contents
    with open(transcript_path, 'r', encoding='utf-8') as f:
        for line in f:
            try:
                step = json.loads(line)
                # Look for tool calls to view_file or write_to_file targeting TeePublicDesignManager.jsx
                tool_calls = step.get("tool_calls", [])
                for tc in tool_calls:
                    if tc.get("name") == "view_file" and "TeePublicDesignManager.jsx" in str(tc.get("args")):
                        print("Found view_file step index:", step.get("step_index"))
            except Exception as e:
                pass
