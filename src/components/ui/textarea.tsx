import * as React from "react";
import { cn } from "../../lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-24 w-full min-w-0 border border-paper-line bg-white px-3 py-2 text-sm leading-6 text-paper-ink transition-colors placeholder:text-paper-muted focus:border-paper-accent focus:outline-none focus:ring-1 focus:ring-paper-accent disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
));

Textarea.displayName = "Textarea";
