import { cn } from "@/lib/cn";

/**
 * South Point wordmark, built from the logo: cobalt "South", golden "Point",
 * grass-green "cafe and lounge", warm-ink tagline — set in the rounded display
 * face. `sm`/`md` render a compact inline lockup for the sidebar; `lg` renders
 * the stacked identity for the login / marketing surfaces.
 */
export function Wordmark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  if (size === "lg") {
    return (
      <span className="inline-flex flex-col items-center gap-1 text-center leading-[0.85]">
        <span className="font-display text-6xl font-bold tracking-tight text-court">
          South
        </span>
        <span className="font-display text-6xl font-bold tracking-tight text-sun-deep">
          Point
        </span>
        <span className="mt-2 font-display text-sm font-semibold uppercase tracking-[0.2em] text-grass">
          Cafe and Lounge
        </span>
        <span className="mt-1.5 flex items-center gap-2 text-xs font-semibold tracking-wide text-roast">
          Rally
          <span aria-hidden className="size-1.5 rounded-full bg-court" />
          Refuel
          <span aria-hidden className="size-1.5 rounded-full bg-sun-deep" />
          Relax
        </span>
      </span>
    );
  }

  const text = size === "sm" ? "text-base" : "text-xl";
  return (
    <span className="inline-flex flex-col leading-none">
      <span className={cn("font-display font-bold tracking-tight", text)}>
        <span className="text-court">South</span>{" "}
        <span className="text-sun-deep">Point</span>
      </span>
      {size !== "sm" && (
        <span className="mt-1 font-display text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-grass">
          Cafe &amp; Lounge
        </span>
      )}
    </span>
  );
}
