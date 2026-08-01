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
          DEFAULT: '#252a35',
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
        muted: '#8b95a8',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
