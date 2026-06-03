import os

path = r"c:\Users\dynast\Desktop\chofi bntk\my project autmation\frontend\src\components\TeePublicDesignManager.jsx"

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

target = """  function requireUnlocked() {
    if (!isWorkspaceLocked) return true;
    handleLockedAction();
    return false;
  }"""

replacement = """  function requireUnlocked() {
    if (!isWorkspaceLocked) return true;
    handleLockedAction();
    return false;
  }

  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [generatingAllIndex, setGeneratingAllIndex] = useState(0);
  const [generatingAllTotal, setGeneratingAllTotal] = useState(0);
  const [generatingAllError, setGeneratingAllError] = useState("");
  const stopGeneratingAllRef = useRef(false);
  const [showBatchProgressModal, setShowBatchProgressModal] = useState(false);
  const [batchItems, setBatchItems] = useState([]);

  // Custom toast notification state
  const [toast, setToast] = useState(null);
  
  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  }

  const [createImageReplacements, setCreateImageReplacements] = useState({});
  const [clearedCreateImageIds, setClearedCreateImageIds] = useState(new Set());
  const createReplacementInputRef = useRef(null);"""

# Replace and check
if target in content:
    content = content.replace(target, replacement)
    print("Restore & Add Succeeded!")
else:
    # Try with CRLF
    target_crlf = target.replace("\n", "\r\n")
    if target_crlf in content:
        content = content.replace(target_crlf, replacement.replace("\n", "\r\n"))
        print("CRLF Restore & Add Succeeded!")
    else:
        print("Target function not found!")

with open(path, "w", encoding="utf-8", newline="") as f:
    f.write(content)
print("Complete!")
