import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const AUTH_MESSAGES = {
  signupSuccess:
    "Account created successfully 🎉 A confirmation email has been sent to your inbox. Please verify your email address before signing in.",
  emailNotConfirmed:
    "Email not confirmed. Please check your inbox and confirm your account before signing in.",
  invalidCredentials: "Invalid email or password.",
  loginSuccess: "Login successful. Redirecting to dashboard.",
  logoutSuccess: "Logged out successfully.",
  googleError: "Google login failed. Please try again.",
  resendSuccess: "Confirmation email sent again. Please check your inbox.",
  missingFields: "Enter your email and password.",
  passwordTooShort: "Password must be at least 8 characters.",
  passwordMismatch: "Passwords do not match.",
  acceptTerms: "Please accept the terms before creating an account.",
  // Forgot / reset password
  resetEmailSent:
    "If an account exists for this email, we sent a password reset link. Please check your inbox.",
  resetSuccess: "Your password has been updated successfully.",
  resetInvalidLink: "This reset link is invalid or has expired. Please request a new one.",
  resetMissingEmail: "Please enter your email address.",
  resetInvalidEmail: "Please enter a valid email address."
};

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true
      }
    })
  : null;

export function isEmailNotConfirmedError(error) {
  const text = `${error?.message || ""} ${error?.code || ""} ${error?.name || ""}`.toLowerCase();
  return text.includes("email not confirmed") || text.includes("email_not_confirmed");
}

export function getAuthErrorMessage(error, fallback = "Authentication failed. Please try again.") {
  const text = `${error?.message || ""} ${error?.code || ""}`.toLowerCase();

  if (isEmailNotConfirmedError(error)) return AUTH_MESSAGES.emailNotConfirmed;

  if (text.includes("invalid login credentials") || text.includes("invalid credentials")) {
    return AUTH_MESSAGES.invalidCredentials;
  }

  if (text.includes("email rate limit")) {
    return "Too many email requests. Please wait a minute and try again.";
  }

  if (text.includes("user already registered")) {
    return "If an account exists for this email, follow the next steps shown in the app.";
  }

  if (text.includes("password should be at least") || text.includes("weak password")) {
    return AUTH_MESSAGES.passwordTooShort;
  }

  return error?.message || fallback;
}

/**
 * Maps errors from the password-reset flow to safe, user-friendly messages.
 * Never exposes raw Supabase internals.
 */
export function getResetErrorMessage(error) {
  const text = `${error?.message || ""} ${error?.code || ""}`.toLowerCase();

  if (text.includes("rate limit") || text.includes("too many")) {
    return "Too many requests. Please wait a moment and try again.";
  }
  if (
    text.includes("invalid") ||
    text.includes("expired") ||
    text.includes("otp") ||
    text.includes("token")
  ) {
    return AUTH_MESSAGES.resetInvalidLink;
  }
  if (text.includes("password should be at least") || text.includes("weak password")) {
    return AUTH_MESSAGES.passwordTooShort;
  }

  return "Something went wrong. Please try again.";
}
