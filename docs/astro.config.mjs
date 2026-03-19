import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLlmsTxt from "starlight-llms-txt";
import starlightThemeObsidian from "starlight-theme-obsidian";

export default defineConfig({
  site: "https://zeroback.dev",
  integrations: [
    starlight({
      title: "Zeroback",
      favicon: "/favicon.svg",
      description:
        "Open-source real-time backend for Cloudflare. Type-safe functions, reactive queries, your infrastructure.",
      plugins: [
        starlightLlmsTxt(),
        starlightThemeObsidian({
          backlinks: false,
          graph: false,
        }),
      ],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/zerodeploy-dev/zeroback",
        },
        {
          icon: "x.com",
          label: "X",
          href: "https://x.com/ranyefet",
        },
      ],
      sidebar: [
        {
          label: "Start Here",
          items: [
            { label: "Getting Started", slug: "getting-started" },
            { label: "Quickstart: React", slug: "quickstart-react" },
            { label: "How It Works", slug: "how-it-works" },
            { label: "Why I Built Zeroback", slug: "blog/why-i-built-zeroback" },
            { label: "Deployment", slug: "deployment" },
          ],
        },
        {
          label: "Core Concepts",
          items: [
            { label: "Schema", slug: "schema" },
            { label: "Functions", slug: "functions" },
            { label: "Database", slug: "database" },
          ],
        },
        {
          label: "Client & Frameworks",
          items: [
            { label: "Client", slug: "client" },
            { label: "React", slug: "react" },
            { label: "Solid.js", slug: "solid" },
          ],
        },
        {
          label: "Features",
          items: [
            { label: "Authentication", slug: "authentication" },
            { label: "Scheduling", slug: "scheduling" },
            { label: "File Storage", slug: "storage" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "CLI", slug: "cli" },
            { label: "llms.txt", link: "/llms.txt" },
            { label: "llms-full.txt", link: "/llms-full.txt" },
          ],
        },
      ],
      components: {
        Footer: "./src/components/StarlightFooter.astro",
        ThemeProvider: "./src/components/ThemeProvider.astro",
        ThemeSelect: "./src/components/ThemeSelect.astro",
      },
      tableOfContents: false,
      customCss: ["./src/styles/custom.css"],
      head: [
        {
          tag: "meta",
          attrs: {
            property: "og:image",
            content: "https://zeroback.dev/og.png",
          },
        },
      ],
    }),
  ],
});
