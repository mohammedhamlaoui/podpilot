import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { AuthProvider } from "./auth/AuthContext.jsx";
import WhatsAppFloatingButton from "./components/WhatsAppFloatingButton.jsx";
import AppErrorBoundary from "./components/AppErrorBoundary.jsx";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <AuthProvider>
        <App />
        <WhatsAppFloatingButton />
      </AuthProvider>
    </AppErrorBoundary>
  </React.StrictMode>
);
