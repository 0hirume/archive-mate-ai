import tailwind from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
    root: "frontend",
    plugins: [solid(), tailwind()],

    server: {
        host: "127.0.0.1",
        port: 5173,
        strictPort: true,
        proxy: { "/api": "http://127.0.0.1:3001" },
    },

    build: { outDir: "../dist/frontend", emptyOutDir: true },
});
