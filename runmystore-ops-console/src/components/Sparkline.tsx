export function Sparkline({ points, width = 120, height = 28, label }: { points: number[]; width?: number; height?: number; label?: string }) {
  const max = Math.max(1, ...points);
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - 2 - (p / max) * (height - 4)).toFixed(1)}`).join(" ");
  const area = `${d} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label ?? `${points.reduce((a, b) => a + b, 0)} events in the last 24 hours`} className="block">
      <path d={area} fill="rgba(13,115,119,0.25)" />
      <path d={d} fill="none" stroke="#0d7377" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
