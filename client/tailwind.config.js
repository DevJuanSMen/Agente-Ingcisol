/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Marca INGCISOL — naranja como acento principal
        primary: {
          DEFAULT: '#E85D04',
          50: '#FCEFE6',
          100: '#FADFCD',
          200: '#F6BE9A',
          300: '#F29A66',
          400: '#FF6B1A',
          500: '#E85D04',
          600: '#C24E03',
          700: '#A03E00', // Orange Dim
          800: '#7A2F00',
        },
        // Escala Ink — fondos y textos oscuros de marca
        ink: {
          DEFAULT: '#0F1114',
          950: '#0F1114',
          900: '#15181D',
          800: '#1C2027',
          700: '#252A32',
          600: '#22262C',
        },
        // Escala Silver — neutros de marca
        silver: {
          50: '#F4F6F8',
          100: '#E2E5EA',
          200: '#BEC3CB',
          300: '#9097A1',
          400: '#5E6571',
          500: '#3A3E47',
          600: '#22262C',
        },
        amber: {
          DEFAULT: '#F5A623',
        },
        success: '#22C55E',
        warning: '#F59E0B',
        danger: '#EF4444',
        bg: '#F4F6F8',
      },
      fontFamily: {
        sans: ['Geist', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
