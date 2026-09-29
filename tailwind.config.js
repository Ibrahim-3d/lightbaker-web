export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "./apps/**/*.{ts,tsx}",
    "./packages/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: Object.fromEntries(
        [
          "bg-0",
          "bg-1",
          "bg-2",
          "bg-3",
          "border",
          "accent",
          "stale",
          "text-0",
          "text-1",
          "text-2",
        ].map((k) => [k, `var(--color-${k})`]),
      ),
    },
  },
  plugins: [],
};
