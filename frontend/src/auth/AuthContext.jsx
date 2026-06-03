import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    let isMounted = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (isMounted) {
          setSession(data.session || null);
        }
      })
      .catch((error) => {
        console.warn("Could not restore Supabase session:", error);
        if (isMounted) {
          setSession(null);
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      setLoading(false);
    });

    const handleAuthRequired = () => {
      setSession(null);
      setLoading(false);
    };
    window.addEventListener("podpilot:auth-required", handleAuthRequired);

    return () => {
      isMounted = false;
      window.removeEventListener("podpilot:auth-required", handleAuthRequired);
      subscription?.subscription?.unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) {
      throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
    }

    const params = new URLSearchParams(window.location.search);
    let redirectToUrl = `${window.location.origin}/dashboard`;
    if (window.location.pathname === "/checkout") {
      redirectToUrl = `${window.location.origin}/checkout${window.location.search}`;
    } else if (params.get("source") === "extension") {
      redirectToUrl = `${window.location.origin}/dashboard?source=extension`;
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: redirectToUrl
      }
    });

    if (error) {
      throw error;
    }

    return data;
  }, []);

  const signInWithPassword = useCallback(async ({ email, password }) => {
    if (!supabase) {
      throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      throw error;
    }

    return data;
  }, []);

  const signUpWithPassword = useCallback(async ({ email, password }) => {
    if (!supabase) {
      throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/email-confirmed`
      }
    });

    if (error) {
      throw error;
    }

    return data;
  }, []);

  const resendConfirmationEmail = useCallback(async ({ email }) => {
    if (!supabase) {
      throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
    }

    const { data, error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/email-confirmed`
      }
    });

    if (error) {
      throw error;
    }

    return data;
  }, []);

  /**
   * Sends a password-reset email via Supabase.
   * The redirectTo URL must be listed in Supabase Dashboard →
   * Authentication → URL Configuration → Redirect URLs.
   * Supabase will append the recovery token as a hash fragment to this URL:
   *   http://localhost:5173/reset-password#access_token=...&type=recovery
   * The Supabase JS client reads that hash automatically via detectSessionInUrl.
   */
  const sendPasswordReset = useCallback(async ({ email }) => {
    if (!supabase) {
      throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
    }

    const redirectTo = `${window.location.origin}/reset-password`;

    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo
    });

    if (error) {
      throw error;
    }

    return data;
  }, []);

  /**
   * Updates the current user's password.
   * Only callable after the user has landed via the reset link and Supabase
   * has established a temporary recovery session.
   */
  const updatePassword = useCallback(async ({ password }) => {
    if (!supabase) {
      throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
    }

    const { data, error } = await supabase.auth.updateUser({ password });

    if (error) {
      throw error;
    }

    return data;
  }, []);

  /**
   * Updates the current user's email.
   * Supabase will send a confirmation email to both old and new addresses.
   */
  const updateEmail = useCallback(async ({ email, options }) => {
    if (!supabase) {
      throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
    }

    const { data, error } = await supabase.auth.updateUser({ email }, options);

    if (error) {
      throw error;
    }

    return data;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) {
      setSession(null);
      return;
    }

    const { error } = await supabase.auth.signOut();

    if (error) {
      throw error;
    }

    setSession(null);
  }, []);

  const value = useMemo(
    () => ({
      isConfigured: isSupabaseConfigured,
      loading,
      session,
      user: session?.user || null,
      isAuthenticated: Boolean(session?.user),
      signInWithGoogle,
      signInWithPassword,
      signUpWithPassword,
      resendConfirmationEmail,
      sendPasswordReset,
      updatePassword,
      updateEmail,
      signOut
    }),
    [
      loading,
      resendConfirmationEmail,
      sendPasswordReset,
      session,
      signInWithGoogle,
      signInWithPassword,
      signOut,
      signUpWithPassword,
      updatePassword,
      updateEmail
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
