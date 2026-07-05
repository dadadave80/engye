import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// animate-ui / shadcn convention: merge conditional classes, de-dupe Tailwind conflicts.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
