/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy:    '#05080F',
        surface: '#090E1A',
        card:    '#0C1422',
        border:  '#1E2D3D',
        accent:  '#0EA5E9',
        green:   '#10B981',
        amber:   '#F59E0B',
        orange:  '#F97316',
        purple:  '#8B5CF6',
        teal:    '#0D9488',
        red:     '#EF4444',
        cyan:    '#06B6D4',
        muted:   '#4A6A8A',
      },
    },
  },
  plugins: [],
}