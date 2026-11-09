"use client";
import { useState } from "react";
import type { Hazard } from "@/lib/hazards/model";
export default function HazardList({
  hazards,
  onAction,
  admin = false,
  floorNames,
}: {
  hazards: Hazard[];
  onAction: (
    id: string,
    action: "confirm" | "dismiss" | "expire",
    token?: string,
  ) => void;
  admin?: boolean;
  floorNames?: Record<number, string>;
}) {
  const [token, setToken] = useState("");
  return (
    <section className="status-card">
      <h2>Reported hazards</h2>
      {admin && (
        <label>
          Admin access token for removing persistent hazards
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
      )}
      {!hazards.length && (
        <p className="status-line">
          No active hazard reports. Camera scans do not establish that a route
          is safe.
        </p>
      )}
      {hazards.map((h) => (
        <article className="hazard-item" key={h.id}>
          <strong className="hazard-icon">⚠ {h.type}</strong> ·{" "}
          {floorNames?.[h.floor] ?? `Floor ${h.floor}`} ·{" "}
          {h.severity === 3 ? "blocked" : "avoid"}
          <p className="status-line">
            {h.edge
              ? `Edge ${h.edge.join(" ↔ ")}`
              : `${h.nodeIds.length} affected point(s)`}{" "}
            · {h.confirmations} confirmation(s) ·{" "}
            {h.source === "admin"
              ? "persistent"
              : `${Math.max(0, Math.ceil((h.expiresAt - Date.now()) / 60000))} min remaining`}
          </p>
          <div className="button-row">
            <button
              onClick={() => onAction(h.id, "confirm", token || undefined)}
            >
              Confirm
            </button>
            <button
              onClick={() => onAction(h.id, "dismiss", token || undefined)}
            >
              Dismiss
            </button>
            {admin && (
              <button
                disabled={token.length < 24}
                onClick={() => onAction(h.id, "expire", token)}
              >
                Expire now
              </button>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
