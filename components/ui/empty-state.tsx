export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-(--radius-card) border border-dashed border-line bg-paper/50 px-6 py-14 text-center">
      {icon && <div className="mb-3 text-latte">{icon}</div>}
      <p className="font-medium text-roast">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-latte">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
