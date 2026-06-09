/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brandDark: '#0A0E1A',
        brandCard: 'rgba(17, 24, 39, 0.7)',
        brandBorder: 'rgba(255, 255, 255, 0.08)',
        accentPrimary: '#3B82F6',
        accentSuccess: '#10B981',
        accentWarning: '#F59E0B'
      }
    },
  },
  plugins: [],
}
