import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          600: '#2563eb',
          700: '#1d4ed8',
        },
      },
      boxShadow: {
        soft: '0 24px 80px rgba(15, 23, 42, 0.14)',
      },
    },
  },
  plugins: [],
} satisfies Config;
