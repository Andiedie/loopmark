import * as React from "react";
import { cn } from "../../lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-9 w-full min-w-0 border border-paper-line bg-white px-3 text-sm leading-9 text-paper-ink transition-colors placeholder:text-paper-muted focus:border-paper-accent focus:outline-none focus:ring-1 focus:ring-paper-accent disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
));

Input.displayName = "Input";
