"use client";
import { floorLabel, type BuildingConfig } from "@/lib/buildings";
export default function RoomDirectory({
  config,
  floor,
  selected,
  onSelect,
}: {
  config: BuildingConfig;
  floor: number;
  selected?: string;
  onSelect: (id: string) => void;
}) {
  const rooms = config.rooms?.filter((r) => r.floor === floor) ?? [];
  if (!rooms.length) return null;
  const room = rooms.find((r) => r.id === selected);
  return (
    <section className="room-directory">
      <div className="room-heading">
        <div>
          <p className="eyebrow">{floorLabel(config, floor)}</p>
          <h2>Rooms & spaces</h2>
        </div>
        <span className="estimate-badge">Approximate layout</span>
      </div>
      {config.heightSource && (
        <p className="height-source">{config.heightSource}</p>
      )}
      <div className="room-grid">
        {rooms.map((r) => (
          <button
            key={r.id}
            className={`room-card ${selected === r.id ? "selected" : ""}`}
            onClick={() => onSelect(r.id)}
            aria-pressed={selected === r.id}
          >
            <span className="room-swatch" style={{ background: r.color }} />
            <span>{r.label}</span>
            <small>
              {(r.rect[2] - r.rect[0]).toFixed(1)} ×{" "}
              {(r.rect[3] - r.rect[1]).toFixed(1)} m · est.
            </small>
          </button>
        ))}
      </div>
      {room && (
        <p className="room-selected" role="status">
          Selected: <strong>{room.label}</strong> · Highlighted in the 3D view.
          Room sizes, furniture and door positions are illustrative.
        </p>
      )}
      <details className="assumption-details">
        <summary>Dimensions and assumptions</summary>
        <ul>
          {config.assumptions?.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <div className="artifact-links">
          <a href={config.glb ?? undefined} download>
            Download 3D model (.glb)
          </a>
          <a href={`/models/${config.id}-rooms.obj`} download>
            Room geometry (.obj)
          </a>
          <a href={`/models/${config.id}-rooms-bundle.zip`} download>
            Complete model bundle (.zip)
          </a>
          <a href={config.planImage} target="_blank" rel="noreferrer">
            View source plan
          </a>
        </div>
        <p className="status-line">
          The ZIP includes OBJ geometry, materials, label textures and the
          original plan.
        </p>
      </details>
    </section>
  );
}
