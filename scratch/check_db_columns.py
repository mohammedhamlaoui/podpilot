import sys
import os

# Add backend directory to sys.path so we can import app modules
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

try:
    from app.services.supabase_service import _admin, DESIGN_TABLE
    print("Supabase client imported successfully.")
    
    # Try selecting a non-existent column to see what columns are in designs table
    # or perform a select limit 1
    res = _admin.table(DESIGN_TABLE).select("*").limit(1).execute()
    if res.data:
        print("Designs table columns available in first row:")
        for col in res.data[0].keys():
            print(f" - {col}")
    else:
        print("No designs found in database. Trying to inspect table metadata via schema description.")
        # Alternatively, run an empty select
        res_empty = _admin.table(DESIGN_TABLE).select("*").limit(0).execute()
        print("Successfully executed empty select. Designs table is active.")
except Exception as e:
    print(f"Error querying Supabase designs table: {e}")
