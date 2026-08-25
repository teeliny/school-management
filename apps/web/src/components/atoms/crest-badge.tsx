import { cn } from "../../lib/cn";

export interface CrestBadgeProps {
  letter: string;
  /** Image source to swap in for dark mode when `letter` is itself an image source. */
  darkLetter?: string;
  size?: "sm" | "lg";
  variant?: "outline" | "solid";
  className?: string;
}

const sizeClass = {
  sm: "h-[38px] w-[38px] text-sm",
  lg: "h-[52px] w-[52px] text-lg",
};

const isImageSource = (letter: string) => /^(\/|https?:\/\/|data:)/.test(letter);

export function CrestBadge({ letter, darkLetter, size = "sm", variant = "outline", className }: CrestBadgeProps) {
  const isImage = isImageSource(letter);

  return (
    <div
      className={cn(
        "relative flex flex-none items-center justify-center",
        sizeClass[size],
        isImage
          ? undefined
          : cn(
              "overflow-hidden rounded-full",
              variant === "outline"
                ? "border-[1.5px] border-[rgb(var(--primary-foreground)/0.55)] text-primary-foreground " +
                    "before:absolute before:inset-1 before:rounded-full before:border before:border-[rgb(var(--primary-foreground)/0.35)]"
                : "border border-primary bg-primary text-primary-foreground",
            ),
        className,
      )}
    >
      {isImage ? (
        darkLetter ? (
          <>
            <img src={letter} alt="" className="block h-full w-full object-contain dark:hidden" />
            <img src={darkLetter} alt="" className="hidden h-full w-full object-contain dark:block" />
          </>
        ) : (
          <img src={letter} alt="" className="h-full w-full object-contain" />
        )
      ) : (
        <span className="font-display font-semibold">{letter}</span>
      )}
    </div>
  );
}
