export function Stripes({ large = false, className = "" }: { large?: boolean; className?: string }) {
  return (
    <span className={`stripes ${large ? "lg" : ""} ${className}`} aria-hidden="true"><i /><i /><i /><i /><i /></span>
  );
}
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow"><Stripes />{children}</p>;
}
export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="grid justify-items-center gap-3 py-14 text-center">
      <Stripes large />
      <p className="title text-lg">{title}</p>
      {children && <p className="text-dim max-w-md text-sm">{children}</p>}
    </div>
  );
}
