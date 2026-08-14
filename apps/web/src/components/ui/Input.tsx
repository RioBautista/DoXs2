import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
};

export function Input({ className, label, hint, id, ...props }: InputProps) {
  const inputId = id ?? props.name;
  return (
    <label className="block" htmlFor={inputId}>
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      <input
        id={inputId}
        className={cn(
          'h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-600 focus:ring-4 focus:ring-blue-100',
          className,
        )}
        {...props}
      />
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}
