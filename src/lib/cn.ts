import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Joins class names into one string. Falsy values are dropped, so `active && 'x'` works. When two classes
// set the same thing (say `p-2` and `p-4`), the later one wins and the earlier one is removed.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
