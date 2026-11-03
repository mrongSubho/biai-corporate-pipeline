/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        biai: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c', /* Authentic BIAI Burnt Orange */
          800: '#9a3412',
          900: '#7c2d12',
          950: '#431407',
        },
        warm: {
          50: '#FAF9F6',   /* BIAI warm ivory canvas */
          100: '#F3F2ED',  /* BIAI recessed column wells */
          200: '#E7E5DD',  /* Subtle dividers */
          300: '#D5D2C7',
          700: '#4A4843',
          800: '#2E2D2A',
          900: '#1C1B19',
        },
        slate: {
          850: '#131B2E',  /* High-contrast obsidian card */
          950: '#080C14'   /* Deepest obsidian canvas */
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
        bengali: ['"Noto Sans Bengali"', '"SolaimanLipi"', 'sans-serif']
      },
      boxShadow: {
        'card': '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.04)',
        'card-selected': '0 0 0 2px #C2410C, 0 4px 6px -1px rgba(194, 65, 12, 0.1)',
        'drawer': '-4px 0 24px -2px rgba(0, 0, 0, 0.08)'
      }
    },
  },
  plugins: [],
}
