import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { SignOut, User, Storefront, GearSix } from "@phosphor-icons/react";

const LOGO_URL = "https://customer-assets.emergentagent.com/job_party-power-1/artifacts/yz1zsziz_Collectivesaverslogo.png.png";

export default function Navbar() {
  const { user, logout, updateRole } = useAuth();
  const navigate = useNavigate();

  const handleRole = async (role) => {
    await updateRole(role);
    if (role === "supplier") navigate("/supplier");
    else if (role === "admin") navigate("/admin");
    else navigate("/dashboard");
  };

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
          {user && (
            <Link to="/browse" className="px-3 py-2 hover:bg-[#F4F4F4]" data-testid="nav-browse">Browse Waves</Link>
          )}
          {user && (
            <Link to="/dashboard" className="px-3 py-2 hover:bg-[#F4F4F4]" data-testid="nav-dashboard">My Waves</Link>
          )}
          {user?.role === "supplier" && (
            <Link to="/supplier" className="px-3 py-2 hover:bg-[#F4F4F4]" data-testid="nav-supplier">Supplier</Link>
          )}
          {user?.role === "admin" && (
            <Link to="/admin" className="px-3 py-2 hover:bg-[#F4F4F4]" data-testid="nav-admin">Admin</Link>
          )}
        </div>

        <div className="flex items-center gap-2">
          {user ? (
            <>
              <div className="hidden md:flex items-center gap-1 border-2 border-ink p-1">
                <button
                  onClick={() => handleRole("consumer")}
                  className={`px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${user.role === "consumer" ? "bg-ink text-white" : "hover:bg-[#F4F4F4]"}`}
                  data-testid="role-consumer-btn"
                >
                  <User size={12} weight="bold" className="inline mr-1" />Consumer
                </button>
                <button
                  onClick={() => handleRole("supplier")}
                  className={`px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${user.role === "supplier" ? "bg-ink text-white" : "hover:bg-[#F4F4F4]"}`}
                  data-testid="role-supplier-btn"
                >
                  <Storefront size={12} weight="bold" className="inline mr-1" />Supplier
                </button>
                <button
                  onClick={() => handleRole("admin")}
                  className={`px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${user.role === "admin" ? "bg-ink text-white" : "hover:bg-[#F4F4F4]"}`}
                  data-testid="role-admin-btn"
                >
                  <GearSix size={12} weight="bold" className="inline mr-1" />Admin
                </button>
              </div>
              <div className="flex items-center gap-2">
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
            </>
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
