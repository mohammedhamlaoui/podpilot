import sys

try:
    from PIL import Image
    print("Pillow is installed! PIL version:", sys.modules.get('PIL').__version__ if sys.modules.get('PIL') else "unknown")
except ImportError:
    print("Pillow is NOT installed.")
