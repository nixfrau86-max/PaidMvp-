import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "./lib/auth";

import Landing from "./pages/Landing";
import Browse from "./pages/Browse";
import VPPDetail from "./pages/VPPDetail";
import Checkout from "./pages/Checkout";
import CheckoutSuccess from "./pages/CheckoutSuccess";
import MyParties from "./pages/MyParties";
import SupplierDashboard from "./pages/SupplierDashboard";
import SupplierOnboarding from "./pages/SupplierOnboarding";
import SupplierWaveNew from "./pages/SupplierWaveNew";
import GarageOnboarding from "./pages/GarageOnboarding";
import GarageDashboard from "./pages/GarageDashboard";
import BookFitter from "./pages/BookFitter";
import AdminPanel from "./pages/AdminPanel";
import AuthCallback from "./pages/AuthCallback";
import Login from "./pages/Login";
import TyreWaves from "./pages/TyreWaves";
import TyreWaveDetail from "./pages/TyreWaveDetail";
import SupplierProductGroups from "./pages/SupplierProductGroups";

function AppRouter() {
  const location = useLocation();
  // CRITICAL: Detect session_id during render, before any other route logic
  if (location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/browse" element={<Browse />} />
      <Route path="/tyres" element={<TyreWaves />} />
      <Route path="/tyre-wave/:id" element={<TyreWaveDetail />} />
      <Route path="/vpp/:id" element={<VPPDetail />} />
      <Route path="/checkout/:vppId" element={<Checkout />} />
      <Route path="/checkout/success" element={<CheckoutSuccess />} />
      <Route path="/dashboard" element={<MyParties />} />
      <Route path="/supplier" element={<SupplierDashboard />} />
      <Route path="/supplier/onboarding" element={<SupplierOnboarding />} />
      <Route path="/supplier/waves/new" element={<SupplierWaveNew />} />
      <Route path="/supplier/product-groups" element={<SupplierProductGroups />} />
      <Route path="/supplier/product-groups/:pgId" element={<SupplierProductGroups />} />
      <Route path="/garage" element={<GarageDashboard />} />
      <Route path="/garage/onboarding" element={<GarageOnboarding />} />
      <Route path="/book/:vppId" element={<BookFitter />} />
      <Route path="/admin" element={<AdminPanel />} />
    </Routes>
  );
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: "#FFFFFF",
                color: "#0A0A0A",
                border: "2px solid #0A0A0A",
                borderRadius: 0,
                boxShadow: "4px 4px 0 0 #0A0A0A",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 12,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              },
            }}
          />
          <AppRouter />
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}

export default App;
