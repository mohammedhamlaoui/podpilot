editor_path = r"c:\Users\dynast\Desktop\chofi bntk\my project autmation\frontend\src\components\TeePublicEditor.jsx"

with open(editor_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Let's locate the beginning up to const TABS = ["Info", "Colors", "Products"];
end_idx = content.find('const TABS = ["Info", "Colors", "Products"];')

if end_idx == -1:
    print("Could not find const TABS in file!")
else:
    print("Found const TABS at index:", end_idx)
    # Let's replace everything before it with the complete, clean imports block
    clean_imports = """import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { batchUpdateDesigns, generateListingContent, listDesigns, updateDesign, uploadDesignImage } from "../api/client";
import ColorDropdown from "./ColorDropdown";
import Icon from "./Icon";
import { LoadingButton, SavingOverlay } from "./LoadingComponents";
import {
  TEEPUBLIC_ALL_PRODUCT_KEYS,
  TEEPUBLIC_COLOR_PRODUCTS,
  TEEPUBLIC_COLORS,
  TEEPUBLIC_DEFAULT_COLORS,
  TEEPUBLIC_PRODUCTS,
  TEEPUBLIC_TOGGLE_ONLY_PRODUCTS,
  canonicalizeSettings,
  getDefaultColorSettings,
  getDefaultProductSettings,
} from "../config/teepublicOptions";
import { getColorCategory } from "../config/teepublicColorHex";
import {
  applyClipboardToDesign,
  copyAdultContentOnly,
  copyAllConfig,
  copyColorsOnly,
  copyProductsOnly,
  getClipboard,
  getClipboardLabel,
  hasClipboard,
} from "../utils/teepublicClipboard";

"""
    updated_content = clean_imports + content[end_idx:]
    
    with open(editor_path, 'w', encoding='utf-8') as outf:
        outf.write(updated_content)
    print("TeePublicEditor.jsx imports restored and updated successfully.")
