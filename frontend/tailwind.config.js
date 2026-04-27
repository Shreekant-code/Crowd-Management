/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
    "./lib/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#09111f",
        slateblue: "#17345d",
        teal: "#0b8f87",
        signal: "#ff6b57",
        cream: "#f4efe8",
        mist: "#d7e4f3",
      },
      fontFamily: {
        sans: ["Segoe UI", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        panel: "0 20px 60px rgba(8, 20, 40, 0.12)",
      },
    },
  },
  plugins: [],
};

