export default function AdminNav() {
  return (
    <nav className="admin-nav" aria-label="Setup pages">
      <a href="/">← Navigation</a>
      <a href="/admin/alignment">Building alignment</a>
      <a href="/admin/anchors">QR anchors</a>
      <a href="/admin/hazards">Hazards</a>
    </nav>
  );
}
