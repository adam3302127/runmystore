function render(v: unknown, depth = 0): React.ReactNode {
  if (v === null) return <span className="b">null</span>;
  if (typeof v === "string") return <span className="s">&quot;{v}&quot;</span>;
  if (typeof v === "number") return <span className="n">{String(v)}</span>;
  if (typeof v === "boolean") return <span className="b">{String(v)}</span>;
  const pad = "  ".repeat(depth + 1), end = "  ".repeat(depth);
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    return <>{"[\n"}{v.map((x, i) => <span key={i}>{pad}{render(x, depth + 1)}{i < v.length - 1 ? "," : ""}{"\n"}</span>)}{end}{"]"}</>;
  }
  const entries = Object.entries(v as Record<string, unknown>);
  if (!entries.length) return "{}";
  return <>{"{\n"}{entries.map(([k, x], i) => <span key={k}>{pad}<span className="k">&quot;{k}&quot;</span>: {render(x, depth + 1)}{i < entries.length - 1 ? "," : ""}{"\n"}</span>)}{end}{"}"}</>;
}
export function JsonView({ value }: { value: unknown }) {
  return <pre className="json">{render(value)}</pre>;
}
