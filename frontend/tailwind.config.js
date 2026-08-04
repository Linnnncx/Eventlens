/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0a0c10',
          raised: '#12151c',
          card: '#161a22',
          hover: '#1c212b',
        },
        border: {
          DEFAULT: '#2a3140',
          muted: '#1e232d',
        },
        primary: {
          DEFAULT: '#3b82f6',
          dim: '#2563eb',
          muted: '#1e3a5f',
        },
        up: {
          DEFAULT: '#22c55e',
          dim: '#16a34a',
        },
        down: {
          DEFAULT: '#ef4444',
          dim: '#dc2626',
        },
        news: {
          DEFAULT: '#a78bfa',
          dim: '#8b5cf6',
        },
        muted: '#9aa3b5',
      },
      fontFamily: {
        sans: [
          'IBM Plex Sans',
          'Segoe UI',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
        mono: ['IBM Plex Mono', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 24px rgba(0,0,0,0.28)',
        float: '0 12px 40px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04)',
      },
      fontSize: {
        '2xs': ['0.7rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [],
};
