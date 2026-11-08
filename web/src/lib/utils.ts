import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * `String(value)` for loosely typed data (tool input, stored JSON, document fields typed `unknown`).
 * Same result as `String()`: it exists so a deliberate coercion of an untyped value reads as one.
 */
export function textOf(value: unknown): string {
  return String(value);
}
