import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    port: 5173,
    // MiniPay loads the app over an https tunnel; the seller runs beside it.
    proxy: { "/api": "http://localhost:3000" },
  },
});
