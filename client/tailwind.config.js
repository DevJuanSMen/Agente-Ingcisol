/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1B6FF5',
          50: '#EBF2FE',
          100: '#D6E5FD',
          500: '#1B6FF5',
          600: '#1560D4',
          700: '#1050B3',
        },
        amber: {
          DEFAULT: '#F5A623',
        },
        success: '#22C55E',
        warning: '#F59E0B',
        danger: '#EF4444',
        bg: '#F8FAFC',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
