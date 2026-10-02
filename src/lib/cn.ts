import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge only knows Tailwind's built-in shadow names. Without this list it would take our own
// ones (from the @theme block in src/styles/index.css) for shadow colours, and keep both `shadow-chip`
// and `shadow-none` instead of dropping the first. Our colour names work without help.
const twMerge = extendTailwindMerge({
  extend: { theme: { shadow: ['chip', 'popover', 'surface', 'tile-drop', 'tile-rest'] } },
});

// Joins class names into one string. Falsy values are dropped, so `active && 'x'` works. When two classes
// set the same thing (say `p-2` and `p-4`), the later one wins and the earlier one is removed.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
