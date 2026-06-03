"""Legacy SQLAlchemy session shim.

Persistence has moved to Supabase. This module is kept only because some
older imports may still reference `Base` / `engine`. New code MUST use
`app.services.supabase_service`.
"""
