import { cn } from "@/lib/cn";
import {
  cloneElement,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

const fieldClasses =
  "w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm text-espresso placeholder:text-latte focus-visible:border-court focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-court/60 disabled:bg-sand disabled:text-latte";

/**
 * Labelled form field. Associates the label with the control via htmlFor/id and
 * wires hint/error text through aria-describedby (plus aria-invalid on error) so
 * assistive tech announces them. The single child control is cloned to receive
 * these ids.
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const describedBy =
    [error ? errorId : null, hint && !error ? hintId : null].filter(Boolean).join(" ") ||
    undefined;

  let control: React.ReactNode = children;
  let forId: string | undefined = inputId;
  if (isValidElement(children)) {
    const existingId = (children.props as { id?: string }).id;
    forId = existingId ?? inputId;
    control = cloneElement(children as ReactElement<Record<string, unknown>>, {
      id: forId,
      "aria-describedby": describedBy,
      "aria-invalid": error ? true : undefined,
    });
  }

  return (
    <div className="block">
      <label htmlFor={forId} className="mb-1.5 block text-sm font-medium text-roast">
        {label}
      </label>
      {control}
      {hint && !error && (
        <span id={hintId} className="mt-1 block text-xs text-latte">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="mt-1 block text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldClasses, className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldClasses, "min-h-20", className)} {...props} />;
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldClasses, "appearance-none", className)} {...props}>
      {children}
    </select>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <label htmlFor={id} className="text-sm font-medium text-roast">
        {label}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 rounded-full transition-colors disabled:opacity-50",
          checked ? "bg-court" : "bg-line",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-5 rounded-full bg-paper shadow transition-transform",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </button>
    </div>
  );
}
