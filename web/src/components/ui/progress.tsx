import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Progress as ProgressPrimitive } from "radix-ui";

const progressIndicatorVariants = cva(
  "h-full w-full flex-1 rounded-full transition-transform duration-300 motion-reduce:transition-none",
  {
    variants: {
      tone: {
        default: "bg-primary",
        muted: "bg-muted-foreground",
        destructive: "bg-destructive",
      },
    },
    defaultVariants: {
      tone: "default",
    },
  },
);

function Progress({
  className,
  value,
  tone,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> &
  VariantProps<typeof progressIndicatorVariants>) {
  const clamped = Math.min(100, Math.max(0, value ?? 0));
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      data-tone={tone ?? "default"}
      value={value}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={progressIndicatorVariants({ tone })}
        style={{ transform: `translateX(-${100 - clamped}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress, progressIndicatorVariants };
