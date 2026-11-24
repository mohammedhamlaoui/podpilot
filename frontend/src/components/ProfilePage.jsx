import { useState, useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import Icon from "./Icon";
import { supabase, getAuthErrorMessage } from "../lib/supabaseClient";
import BillingCard from "./BillingCard";

function formatDate(dateString) {
  if (!dateString) return "Unknown";
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function ProfilePage({ onSignOut }) {
  const { user, signOut, updateEmail, updatePassword, signInWithPassword, resendConfirmationEmail } = useAuth();
  const handleSignOut = onSignOut || signOut;
  
  const [activeModal, setActiveModal] = useState(null); // 'password' | 'email' | 'help' | null
  const [newDisplayName, setNewDisplayName] = useState("");

  // Password Modal State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Email Modal State
  const [newEmail, setNewEmail] = useState("");
  const [confirmNewEmail, setConfirmNewEmail] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Toast / page notifications
  const [toastMessage, setToastMessage] = useState("");
  const [toastType, setToastType] = useState("");

  // Check if account uses password authentication
  const provider = user?.app_metadata?.provider;
  const providers = user?.app_metadata?.providers || [];
  const identities = user?.identities || [];
  const isPasswordUser = provider === "email" || providers.includes("email") || identities.some(id => id.provider === "email");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("email_change") === "success") {
      // Clear URL parameter so it doesn't show again on refresh
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("email_change");
        window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      } catch (err) {
        console.warn("Could not clean url search parameters:", err);
      }

      const refreshSession = async () => {
        if (supabase) {
          try {
            await supabase.auth.refreshSession();
            await supabase.auth.getUser();
          } catch (err) {
            console.warn("Failed to refresh session after email change confirmation:", err);
          }
        }
      };
      
      refreshSession();
      setToastType("success");
      setToastMessage("Email changed successfully.");
      
      // Auto-hide toast after 6 seconds
      const timer = setTimeout(() => {
        setToastMessage("");
        setToastType("");
      }, 6000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, []);

  const displayName = user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split("@")[0] || "User";
  const avatarLetter = displayName.charAt(0).toUpperCase();
  const isVerified = Boolean(user?.email_confirmed_at);
  const signInMethods = [
    (provider === "google" || providers.includes("google") || identities.some(id => id.provider === "google")) && "Google",
    isPasswordUser && "Email and password",
  ].filter(Boolean).join(" · ") || "Email";

  const showToast = (message, type = "success") => {
    setToastType(type);
    setToastMessage(message);
  };

  const handleNameSubmit = async (event) => {
    event.preventDefault();
    const name = newDisplayName.trim();
    if (name.length < 2 || name.length > 60) {
      setError("Name must be between 2 and 60 characters.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { error: updateError } = await supabase.auth.updateUser({ data: { display_name: name } });
      if (updateError) throw updateError;
      showToast("Your display name has been updated.");
      resetModalState();
    } catch (err) {
      setError(getAuthErrorMessage(err, "Could not update your display name."));
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setLoading(true);
    try {
      await resendConfirmationEmail({ email: user.email });
      showToast("Verification email sent. Check your inbox.");
    } catch (err) {
      showToast(getAuthErrorMessage(err, "Could not send verification email."), "error");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyAccountId = async () => {
    try {
      await navigator.clipboard.writeText(user.id);
      showToast("Account ID copied.");
    } catch {
      showToast("Could not copy the account ID.", "error");
    }
  };

  const resetModalState = () => {
    setActiveModal(null);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setNewEmail("");
    setConfirmNewEmail("");
    setNewDisplayName("");
    setError("");
    setSuccess("");
    setShowCurrentPassword(false);
    setShowNewPassword(false);
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!currentPassword) {
      setError("Current password is required.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError("New passwords do not match.");
      return;
    }
    if (currentPassword === newPassword) {
      setError("New password must be different from current password.");
      return;
    }

    setLoading(true);
    try {
      // Verify current password
      await signInWithPassword({ email: user.email, password: currentPassword });
      
      // Update password
      await updatePassword({ password: newPassword });
      
      setSuccess("Your password has been updated successfully.");
      setTimeout(() => resetModalState(), 2000);
    } catch (err) {
      console.error(err);
      setError("Current password is incorrect or an error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!newEmail || !confirmNewEmail) {
      setError("Please fill out all email fields.");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (newEmail !== confirmNewEmail) {
      setError("New emails do not match.");
      return;
    }
    if (newEmail === user.email) {
      setError("New email must be different from your current email.");
      return;
    }
    if (!currentPassword) {
      setError("Current password is required to change email.");
      return;
    }

    setLoading(true);
    try {
      // Verify current password
      await signInWithPassword({ email: user.email, password: currentPassword });
    } catch (err) {
      console.error(err);
      setError("Current password is incorrect.");
      setLoading(false);
      return;
    }

    try {
      // Update email with options redirecting to /profile?email_change=success
      const redirectTo = `${window.location.origin}/profile?email_change=success`;
      await updateEmail({ 
        email: newEmail, 
        options: { emailRedirectTo: redirectTo } 
      });
      
      setSuccess("Confirmation link sent. Please check your new email to confirm the change. Your current email will stay active until you confirm the new address.");
      setTimeout(() => resetModalState(), 10000);
    } catch (err) {
      console.error(err);
      setError(getAuthErrorMessage(err, "An error occurred while updating your email. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="profile-page">
      {toastMessage && (
        <div className={`profile-alert alert-${toastType}`} style={{ marginBottom: "1.5rem" }}>
          {toastMessage}
        </div>
      )}
      <header className="account-heading">
        <div><span className="account-eyebrow">YOUR WORKSPACE</span><h1>Account settings</h1><p>Manage your profile, sign-in details, and subscription in one place.</p></div>
      </header>
      <div className="profile-grid account-hub">
        <section className="profile-card profile-summary">
          <div className="profile-avatar" aria-hidden="true">{avatarLetter}</div>
          <div className="account-identity">
            <span className="account-eyebrow">PODPILOT MEMBER</span>
            <h2 className="profile-name">{displayName}</h2>
            <p className="profile-email">{user?.email}</p>
            <span className={`profile-badge ${isVerified ? "badge-success" : "badge-warning"}`}>{isVerified ? "Verified email" : "Email not verified"}</span>
          </div>
          <button type="button" className="profile-btn account-identity-action" onClick={() => { setNewDisplayName(displayName); setActiveModal("name"); }}><Icon name="edit" /> Edit profile</button>
        </section>

        <section className="profile-card account-details-card">
          <div className="profile-card-header"><Icon name="user" className="profile-card-icon" /><div><h3>Account details</h3><p>Your identity and activity</p></div></div>
          <div className="account-detail-list">
            <div className="account-detail-row"><span>Email address</span><strong>{user?.email}</strong></div>
            <div className="account-detail-row"><span>Member since</span><strong>{formatDate(user?.created_at)}</strong></div>
            <div className="account-detail-row"><span>Last sign in</span><strong>{formatDate(user?.last_sign_in_at)}</strong></div>
            <div className="account-detail-row"><span>Account ID</span><button type="button" className="account-text-action" onClick={handleCopyAccountId}>Copy ID <Icon name="copy" /></button></div>
          </div>
        </section>

        <section className="profile-card account-security-card">
          <div className="profile-card-header"><Icon name="lock" className="profile-card-icon" /><div><h3>Sign-in & security</h3><p>Keep your account accessible and secure</p></div></div>
          <div className="account-detail-row"><span>Sign-in method</span><strong>{signInMethods}</strong></div>
          <div className="account-setting-list">
            {isPasswordUser && <button type="button" onClick={() => setActiveModal("password")}><Icon name="lock" /><span><strong>Change password</strong><small>Update the password you use to sign in</small></span><Icon name="chevronRight" /></button>}
            <button type="button" onClick={() => setActiveModal("email")}><Icon name="mail" /><span><strong>Change email</strong><small>{isPasswordUser ? "Confirm a new address for your account" : "See how your Google email is managed"}</small></span><Icon name="chevronRight" /></button>
            {!isVerified && <button type="button" onClick={handleResendVerification} disabled={loading}><Icon name="refresh" /><span><strong>Resend verification</strong><small>Get a new confirmation email</small></span><Icon name="chevronRight" /></button>}
          </div>
        </section>

        <BillingCard />

        <section className="profile-card account-footer-card">
          <div><div className="profile-card-header"><Icon name="help" className="profile-card-icon" /><h3>Need a hand?</h3></div><p>We can help with account access, billing, or your PodPilot workflow.</p></div>
          <div className="account-footer-actions"><button type="button" className="profile-btn" onClick={() => setActiveModal("help")}>Contact support</button><button type="button" className="profile-btn btn-danger" onClick={handleSignOut}>Sign out</button></div>
        </section>
      </div>

      {/* Modals */}
      {activeModal && (
        <div className="profile-modal-overlay">
          <div className="profile-modal">
            <button className="modal-close" onClick={resetModalState} aria-label="Close">
              <Icon name="x" />
            </button>

            {activeModal === "name" && (
              <>
                <h2>Edit profile</h2>
                <form onSubmit={handleNameSubmit} className="profile-form">
                  <label className="profile-field"><span>Display name</span><input type="text" value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} minLength={2} maxLength={60} autoFocus required /></label>
                  <p className="account-form-note">This is the name shown in your PodPilot account.</p>
                  {error && <div className="profile-alert alert-error">{error}</div>}
                  <div className="modal-actions"><button type="button" className="btn-cancel" onClick={resetModalState} disabled={loading}>Cancel</button><button type="submit" className="btn-submit" disabled={loading}>{loading ? "Saving..." : "Save name"}</button></div>
                </form>
              </>
            )}
            
            {activeModal === "password" && (
              <>
                <h2>Change Password</h2>
                <form onSubmit={handlePasswordSubmit} className="profile-form">
                  <label className="profile-field">
                    <span>Current Password</span>
                    <div className="profile-input-wrap">
                      <input
                        type={showCurrentPassword ? "text" : "password"}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        disabled={loading || success}
                        placeholder="Enter current password"
                        required
                      />
                      <button
                        type="button"
                        className="profile-password-toggle"
                        onClick={() => setShowCurrentPassword((v) => !v)}
                        tabIndex="-1"
                      >
                        <Icon name={showCurrentPassword ? "eyeOff" : "eye"} />
                      </button>
                    </div>
                  </label>
                  
                  <label className="profile-field">
                    <span>New Password</span>
                    <div className="profile-input-wrap">
                      <input
                        type={showNewPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        disabled={loading || success}
                        placeholder="At least 8 characters"
                        required
                      />
                      <button
                        type="button"
                        className="profile-password-toggle"
                        onClick={() => setShowNewPassword((v) => !v)}
                        tabIndex="-1"
                      >
                        <Icon name={showNewPassword ? "eyeOff" : "eye"} />
                      </button>
                    </div>
                  </label>

                  <label className="profile-field">
                    <span>Confirm New Password</span>
                    <div className="profile-input-wrap">
                      <input
                        type={showNewPassword ? "text" : "password"}
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        disabled={loading || success}
                        placeholder="Repeat new password"
                        required
                      />
                    </div>
                  </label>

                  {error && <div className="profile-alert alert-error">{error}</div>}
                  {success && <div className="profile-alert alert-success">{success}</div>}

                  {!success && (
                    <div className="modal-actions">
                      <button type="button" className="btn-cancel" onClick={resetModalState} disabled={loading}>
                        Cancel
                      </button>
                      <button type="submit" className="btn-submit" disabled={loading}>
                        {loading ? "Updating..." : "Update Password"}
                      </button>
                    </div>
                  )}
                </form>
              </>
            )}

            {activeModal === "email" && (
              <>
                <h2>Change Email</h2>
                {!isPasswordUser ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1rem" }}>
                    <div className="profile-alert alert-warning">
                      Email changes for Google accounts must be managed through your Google account.
                    </div>
                    <div className="modal-actions">
                      <button type="button" className="btn-cancel" onClick={resetModalState} style={{ width: "100%" }}>
                        Close
                      </button>
                    </div>
                  </div>
                ) : success ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1rem" }}>
                    <div className="profile-alert alert-success">
                      {success}
                    </div>
                    <div className="modal-actions">
                      <button type="button" className="btn-cancel" onClick={resetModalState} style={{ width: "100%" }}>
                        Close
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleEmailSubmit} className="profile-form">
                    <label className="profile-field">
                      <span>Current Email</span>
                      <input type="text" value={user?.email} disabled className="input-readonly" />
                    </label>
                    
                    <label className="profile-field">
                      <span>New Email</span>
                      <input
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        disabled={loading}
                        placeholder="new@example.com"
                        required
                      />
                    </label>

                    <label className="profile-field">
                      <span>Confirm New Email</span>
                      <input
                        type="email"
                        value={confirmNewEmail}
                        onChange={(e) => setConfirmNewEmail(e.target.value)}
                        disabled={loading}
                        placeholder="new@example.com"
                        required
                      />
                    </label>

                    <label className="profile-field">
                      <span>Current Password</span>
                      <div className="profile-input-wrap">
                        <input
                          type={showCurrentPassword ? "text" : "password"}
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          disabled={loading}
                          placeholder="Required to confirm changes"
                          required
                        />
                        <button
                          type="button"
                          className="profile-password-toggle"
                          onClick={() => setShowCurrentPassword((v) => !v)}
                          disabled={loading}
                          tabIndex="-1"
                        >
                          <Icon name={showCurrentPassword ? "eyeOff" : "eye"} />
                        </button>
                      </div>
                    </label>

                    {error && <div className="profile-alert alert-error">{error}</div>}

                    <div className="modal-actions">
                      <button type="button" className="btn-cancel" onClick={resetModalState} disabled={loading}>
                        Cancel
                      </button>
                      <button type="submit" className="btn-submit" disabled={loading}>
                        {loading ? "Sending confirmation..." : "Change Email"}
                      </button>
                    </div>
                  </form>
                )}
              </>
            )}

            {activeModal === "help" && (
              <div className="help-modal">
                <h2>Need help?</h2>
                <p>Contact support if you need help with your account or have any questions about PodPilot.</p>
                <a href="mailto:support@podpilot.space" className="support-email">
                  support@podpilot.space
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ProfilePage;
