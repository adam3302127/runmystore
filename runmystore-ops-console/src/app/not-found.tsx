import Link from "next/link";
import { Empty } from "@/components/Stripes";
export default function NotFound() {
  return (
    <main className="flex-1 grid place-items-center p-8"><div className="grid gap-4 text-center"><Empty title="Not here">That page or record doesn&apos;t exist, or you don&apos;t have access to it.</Empty><Link href="/" className="btn justify-self-center">Back to the fleet <span className="arrow" aria-hidden="true">→</span></Link></div></main>
  );
}
