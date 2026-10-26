export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {
    fontFamily: { sans: ['"Public Sans"', 'system-ui', 'Segoe UI', 'Arial', 'sans-serif'] },
    colors: { ink: '#14232b', muted: '#5b6b75', line: '#d5dee3', page: '#eef2f4', brand: { DEFAULT: '#0f4c5c', dark: '#0a3642', soft: '#d9eaee' } },
  } },
  plugins: [],
};
