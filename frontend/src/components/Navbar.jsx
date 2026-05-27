import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { SignOut } from "@phosphor-icons/react";

const LOGO_URL = "https://customer-assets.emergentagent.com/job_party-power-1/artifacts/yz1zsziz_Collectivesaverslogo.png.png";

export default function Navbar() {
  const { user, logout } = useAuth();
  const roleLabel = {
    consumer: "Member",
    supplier: "Supplier",
    garage: "Garage",
    admin: "Admin",
  }[user?.role] || "Member";

  return (
    <nav className="sticky top-0 z-40 bg-white border-b-2 border-ink" data-testid="main-navbar">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-4 sm:px-6 py-3">
        <Link to="/" className="flex items-center gap-2.5" data-testid="nav-logo">
          <span className="inline-flex items-center justify-center w-10 h-10 bg-white border-2 border-ink shadow-brut-sm overflow-hidden">
            <img src={LOGO_URL} alt="Collective Savers" className="w-full h-full object-contain p-0.5" />
          </span>
          <span className="font-display text-base sm:text-lg tracking-tighter uppercase leading-none whitespace-nowrap">
            The Collective Savers<span className="text-[#FF5400]">.</span>
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-1 text-xs font-bold uppercase tracking-[0.15em]">
          {user && (user.role === "consumer" || user.role === "admin") && (
            <Link to="/browse" className="px-3 py-2 hover:bg-[#F4F4F4]" data-testid="nav-browse">Browse Waves</Link>
          )}
          {user && user.role === "consumer" && (
            <Link to="/dashboard" className="px-3 py-2 hover:bg-[#F4F4F4]" data-testid="nav-dashboard">My Waves</Link>
          )}
          {user?.role === "supplier" && (
            <Link to="/supplier" className="px-3 py-2 hover:bg-[#F4F4F4]" data-testid="nav-supplier">Supplier Console</Link>
          )}
          {user?.role === "garage" && (
            <Link to="/garage" className="px-3 py-2 hover:bg-[#F4F4F4]" data-testid="nav-garage">Garage Console</Link>
          )}
          {user?.role === "admin" && (
            <Link to="/admin" className="px-3 py-2 hover:bg-[#F4F4F4]" data-testid="nav-admin">Admin</Link>
          )}
        </div>

        <div className="flex items-center gap-2">
          {user ? (
            <div className="flex items-center gap-2">
              <span
                className="hidden sm:inline-flex items-center gap-1 border-2 border-ink bg-[#FFD600] font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-1"
                data-testid="role-badge"
              >
                {roleLabel}
              </span>
              {user.picture ? (
                <img src={user.picture} alt={user.name} className="w-8 h-8 border-2 border-ink" />
              ) : (
                <div className="w-8 h-8 border-2 border-ink bg-[#FFD600] flex items-center justify-center font-bold text-xs">
                  {user.name?.[0]?.toUpperCase()}
                </div>
              )}
              <button
                onClick={logout}
                className="p-2 border-2 border-ink hover:bg-[#F4F4F4]"
                data-testid="logout-btn"
                aria-label="Logout"
              >
                <SignOut size={16} weight="bold" />
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className="bg-[#FF5400] text-white border-2 border-ink font-bold uppercase tracking-wider px-4 py-2 text-xs shadow-brut-sm hover-brut"
              data-testid="login-btn"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
