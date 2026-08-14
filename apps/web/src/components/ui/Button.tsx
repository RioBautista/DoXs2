import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  isLoading?: boolean;
};

export function Button({ className, isLoading, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex h-11 w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? 'Signing in…' : children}
    </button>
  );
}
