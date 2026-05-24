import React from "react";
import { Link } from "react-router-dom";
import StateBadge from "./StateBadge";
import { Users, Lightning, ArrowRight } from "@phosphor-icons/react";

export default function VPPCard({ vpp }) {
  const progress = Math.min(100, vpp.progress_pct ?? 0);
  return (
    <Link
      to={`/vpp/${vpp.vpp_id}`}
      className="block group bg-white border-2 border-ink shadow-brut hover-brut"
      data-testid={`vpp-card-${vpp.vpp_id}`}
    >
      <div className="relative aspect-[4/3] overflow-hidden border-b-2 border-ink bg-[#F4F4F4]">
        <img
          src={vpp.image_url}
          alt={vpp.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        <div className="absolute top-3 left-3">
          <StateBadge state={vpp.state} progressPct={progress} />
        </div>
        <div className="absolute top-3 right-3 bg-ink text-white border-2 border-ink px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.15em] font-mono">
          −{vpp.savings_pct}%
        </div>
      </div>
      <div className="p-5">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#3A3A3A] mb-1 font-mono">
          {vpp.category}
        </div>
        <h3 className="font-display text-xl leading-tight uppercase mb-3 line-clamp-2 min-h-[3rem]">
          {vpp.title}
        </h3>

        <div className="flex items-baseline gap-2 mb-3">
          <span className="font-display text-3xl">£{vpp.customer_price}</span>
          <span className="line-through text-[#3A3A3A] text-sm">£{vpp.retail_price}</span>
        </div>

        {/* Progress */}
        <div className="mb-3">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.15em] mb-1 font-mono">
            <span className="flex items-center gap-1">
              <Users weight="bold" size={12} />{vpp.participants_count}/{vpp.threshold}
            </span>
            <span>{Math.round(progress)}% POWER</span>
          </div>
          <div className="h-3 border-2 border-ink bg-white relative overflow-hidden">
            <div
              className="h-full"
              style={{
                width: `${progress}%`,
                background: progress >= 100 ? "#0021A5" : progress >= 75 ? "#FFD600" : "#FF5400",
                transition: "width 400ms ease",
              }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between border-t-2 border-ink pt-3 -mb-1">
          <span className="text-[11px] font-bold uppercase tracking-[0.15em] font-mono inline-flex items-center gap-1">
            <Lightning weight="fill" size={12} className="text-[#FF5400]" />
            Join Wave
          </span>
          <ArrowRight weight="bold" size={16} className="group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </Link>
  );
}
