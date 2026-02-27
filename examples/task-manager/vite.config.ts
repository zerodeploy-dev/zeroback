import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@vex/client": path.resolve(__dirname, "node_modules/@vex/client"),
      "@vex/react": path.resolve(__dirname, "node_modules/@vex/react"),
      "@vex/values": path.resolve(__dirname, "node_modules/@vex/values"),
    },
  },
});
