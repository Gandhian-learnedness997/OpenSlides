/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#121214",
        panel: "#1c1c1e",
        border: "#2e2e30",
        secondary: "#a1a1aa",
      }
    },
  },
  plugins: [],
}
