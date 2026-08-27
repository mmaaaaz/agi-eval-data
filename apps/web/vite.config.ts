import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

export default defineConfig({
  plugins: [TanStackRouterVite(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@site/shell": path.resolve(__dirname, "../../packages/site/src/shell.tsx"),
      "@site/data": path.resolve(__dirname, "../../packages/site/src/data.ts"),
      "@site/format": path.resolve(__dirname, "../../packages/site/src/format.ts"),
      "@site/questions": path.resolve(__dirname, "../../packages/site/src/questions.ts"),
      "@site/authoring": path.resolve(__dirname, "../../packages/site/src/authoring.tsx"),
      "@site/grading": path.resolve(__dirname, "../../packages/site/src/grading.tsx"),
      "@site/syncchip": path.resolve(__dirname, "../../packages/site/src/SyncChip.tsx"),
      "@site/thumb": path.resolve(__dirname, "../../packages/site/src/ThumbImage.tsx"),
      "@site/virtual": path.resolve(__dirname, "../../packages/site/src/VirtualGallery.tsx"),
      "@site/section": path.resolve(__dirname, "../../packages/site/src/Section.tsx"),
      "@site/lightbox": path.resolve(__dirname, "../../packages/site/src/Lightbox.tsx"),
      "@site/settings": path.resolve(__dirname, "../../packages/site/src/settings.ts"),
      "@site/ui": path.resolve(__dirname, "../../packages/site/src/ui.tsx"),
      "@site/dataContext": path.resolve(__dirname, "../../packages/site/src/dataContext.tsx"),
    },
  },
});
