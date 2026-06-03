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
  const { user, signOut, updateEmail, updatePassword, signInWithPassword } = useAuth();
  const handleSignOut = onSignOut || signOut;
  
  const [activeModal, setActiveModal] = useState(null); // 'password' | 'email' | 'help' | null

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

  const displayName = user?.user_metadata?.display_name || user?.email?.split("@")[0] || "User";
  const avatarLetter = displayName.charAt(0).toUpperCase();
  const isVerified = Boolean(user?.email_confirmed_at);

  const resetModalState = () => {
    setActiveModal(null);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setNewEmail("");
    setConfirmNewEmail("");
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
      <div className="profile-grid">
        
        {/* Profile Summary Card */}
        <div className="profile-card profile-summary">
          <div className="profile-avatar">{avatarLetter}</div>
          <h2 className="profile-name">{displayName}</h2>
          <p className="profile-email">{user?.email}</p>
        </div>

        {/* Email & Verification Card */}
        <div className="profile-card">
          <div className="profile-card-header">
            <Icon name="mail" className="profile-card-icon" />
            <h3>Email Address</h3>
          </div>
          <div className="profile-card-body">
            <p className="profile-text">{user?.email}</p>
            <div className={`profile-badge ${isVerified ? "badge-success" : "badge-warning"}`}>
              {isVerified ? "Verified" : "Not Verified"}
            </div>
          </div>
        </div>

        {/* Account Info Card */}
        <div className="profile-card">
          <div className="profile-card-header">
            <Icon name="user" className="profile-card-icon" />
            <h3>Account Information</h3>
          </div>
          <div className="profile-card-body account-info-body">
            <div className="info-row">
              <span className="info-label">Member Since</span>
              <span className="info-value">{formatDate(user?.created_at)}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Last Sign In</span>
              <span className="info-value">{formatDate(user?.last_sign_in_at)}</span>
            </div>
          </div>
        </div>

        {/* Billing Card */}
        <BillingCard />

        {/* Account Settings Card */}
        <div className="profile-card account-settings-card">
          <div className="profile-card-header">
            <Icon name="edit" className="profile-card-icon" />
            <h3>Account Settings</h3>
          </div>
          <div className="profile-card-actions">
            <button className="profile-btn" onClick={() => setActiveModal("password")}>
              <Icon name="lock" /> Change Password
            </button>
            <button className="profile-btn" onClick={() => setActiveModal("email")}>
              <Icon name="mail" /> Change Email
            </button>
            <button className="profile-btn" onClick={() => setActiveModal("help")}>
              <Icon name="help" /> Get Help
            </button>
            <button className="profile-btn btn-danger" onClick={handleSignOut}>
              Sign Out
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      {activeModal && (
        <div className="profile-modal-overlay">
          <div className="profile-modal">
            <button className="modal-close" onClick={resetModalState} aria-label="Close">
              <Icon name="x" />
            </button>
            
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
