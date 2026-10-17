import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";

// The brand row at the top of every page; the mark and name link back home.
export function SiteHeader() {
  return (
    <header className="flex items-center">
      <Link href="/" className="-mx-2 flex min-h-11 items-center gap-2.5 rounded-full px-2 text-ink">
        <BrandMark size={28} />
        <span className="text-card-title">CableTrace</span>
      </Link>
    </header>
  );
}
