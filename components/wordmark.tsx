import { cn } from "@/lib/cn";

/** South Point wordmark: a court-green point over a warm café serif. */
export function Wordmark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const text = { sm: "text-base", md: "text-lg", lg: "text-3xl" }[size];
  const dot = { sm: "size-2", md: "size-2.5", lg: "size-4" }[size];
  return (
    <span className={cn("inline-flex items-baseline gap-1.5 font-display font-semibold tracking-tight text-espresso", text)}>
      <span aria-hidden className={cn("self-center rounded-full bg-court", dot)} />
      South Point
      <span className="font-sans text-[0.6em] font-medium uppercase tracking-[0.18em] text-latte">
        Cafe &amp; Lounge
      </span>
    </span>
  );
}
