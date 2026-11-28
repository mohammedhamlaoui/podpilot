import { AlertTriangle, CreditCard } from "lucide-react";
import { useState } from "react";

export default function PaymentRecoveryBanner({ summary, onRecoverPayment }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const graceActive = summary?.past_due_grace_active === true;
  const message = summary?.payment_recovery_message || (
    graceActive
      ? "Payment failed. Please update your payment method to avoid losing access."
      : "Your subscription is past due. Update your payment method to continue using PodPilot."
  );

  async function handleRecovery() {
    if (opening) return;
    setOpening(true);
    setError("");
    try {
      await onRecoverPayment?.();
    } catch (recoveryError) {
      const detail = recoveryError?.response?.data?.detail;
      setError(
        detail?.code === "BILLING_ACCOUNT_RECONCILIATION_REQUIRED" ? detail.message
        : typeof detail === "string" && detail
          ? detail
          : "Could not open the billing portal. Please try again."
      );
    } finally {
      setOpening(false);
    }
  }

  return (
    <section
      className={`pp-payment-recovery-banner${graceActive ? " is-grace" : " is-locked"}`}
      aria-label={graceActive ? "Payment recovery warning" : "Payment recovery required"}
      role={graceActive ? "status" : "alert"}
    >
      <div className="pp-payment-recovery-icon" aria-hidden="true">
        <AlertTriangle />
      </div>
      <div className="pp-payment-recovery-copy">
        <strong>{graceActive ? "Payment failed" : "Payment update required"}</strong>
        <span>{message}</span>
        {error && <small>{error}</small>}
      </div>
      <button
        type="button"
        className="primary-button pp-payment-recovery-action"
        onClick={handleRecovery}
        disabled={opening}
        aria-busy={opening || undefined}
      >
        <CreditCard aria-hidden="true" />
        <span>{opening ? "Opening portal..." : "Update payment method"}</span>
      </button>
    </section>
  );
}
