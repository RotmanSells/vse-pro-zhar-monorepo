import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  envDir: "../..",
  plugins: [react()],
  preview: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(
      ["/admin", "/catalog", "/cart", "/checkout", "/orders", "/media", "/health"].map((path) => [
        path,
        { target: process.env["VITE_PROXY_TARGET"] ?? "http://127.0.0.1:3000", changeOrigin: true }
      ])
    )
  }
});
