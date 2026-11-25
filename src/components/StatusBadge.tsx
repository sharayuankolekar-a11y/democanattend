import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: "present" | "absent" | string;
}

export const StatusBadge = ({ status }: StatusBadgeProps) => {
  const isPresent = status?.toLowerCase() === "present";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold tracking-wide border shadow-sm",
        isPresent
          ? "bg-emerald-50 text-emerald-700 border-emerald-200/80"
          : "bg-rose-50 text-rose-700 border-rose-200/80"
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", isPresent ? "bg-emerald-500" : "bg-rose-500")} />
      <span className="capitalize">{status}</span>
    </span>
  );
};
