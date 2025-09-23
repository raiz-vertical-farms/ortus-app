import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { rootRoute, route, index } from "@tanstack/virtual-file-routes";

export const routes = rootRoute("root.tsx", [
  index("home.tsx"),
  route("signup", "signup.tsx"),
]);

export default defineConfig(({ mode }) => {
  return {
    plugins: [
      tanstackRouter({
        target: "react",
        routesDirectory: "routes",
        autoCodeSplitting: true,
        generatedRouteTree: "routeTree.ts",
      }),
      react(),
    ],
    build: {
      emptyOutDir: true,
    },
  };
});
