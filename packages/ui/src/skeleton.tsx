/* Skeletons — never spinners. Content areas show their shape immediately
   from local data. A spinner may appear only inside a button, never as a
   page. Shimmer is disabled under reduced-motion. */

export function SkeletonRow() {
  return (
    <div
      className="rl-card"
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", borderWidth: 1.5 }}
      aria-hidden
    >
      <div className="rl-skeleton" style={{ width: 40, height: 40, borderRadius: 10 }} />
      <div style={{ flex: 1 }}>
        <div className="rl-skeleton" style={{ height: 13, width: "60%", borderRadius: 6 }} />
        <div className="rl-skeleton--soft rl-skeleton" style={{ height: 10, width: "38%", borderRadius: 5, marginTop: 8 }} />
      </div>
      <div className="rl-skeleton--soft rl-skeleton" style={{ width: 72, height: 26, borderRadius: 999 }} />
    </div>
  );
}
