import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import gruvbox from "starlight-theme-gruvbox";

export default defineConfig({
  site: "https://zeroback.dev",
  integrations: [
    starlight({
      title: "Zeroback",
      description:
        "Open-source real-time backend for Cloudflare. Convex-style DX on your own infrastructure.",
      plugins: [
        gruvbox(),
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
            { label: "How It Works", slug: "how-it-works" },
            {
              label: "Why I Built Zeroback",
              link: "/blog/why-i-built-zeroback",
            },
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
            { label: "Scheduling", slug: "scheduling" },
            { label: "File Storage", slug: "storage" },
          ],
        },
        {
          label: "Reference",
          items: [{ label: "CLI", slug: "cli" }],
        },
      ],
      customCss: [],
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
