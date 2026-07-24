import { defineConfig } from "vitepress";

// Ziro Designer documentation site.
// Layout follows the EasyEDA docs model: a persistent, nested left sidebar
// tree that stays visible on every page, main content, and a right-hand
// "On this page" outline. Brand (colours + fonts) mirrors www.ziroeda.com.
export default defineConfig({
  title: "Ziro Designer",
  titleTemplate: ":title · Ziro Designer Docs",
  description:
    "Documentation for Ziro Designer — the browser-native, open-source PCB engineering suite from ZIRO EDA.",
  lang: "en-US",
  cleanUrls: true,
  lastUpdated: true,
  appearance: "dark", // brand is dark-first; toggle still available

  // Served at designer.ziroeda.com/docs, as a subpath of the app's Vercel
  // deployment. The build emits into the app's output dir under /docs.
  base: "/docs/",
  outDir: "../designer/dist/docs",

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/docs/logo.svg" }],
    ["meta", { name: "theme-color", content: "#08080a" }],
  ],

  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "Ziro Designer",

    nav: [
      { text: "Documentation", link: "/", activeMatch: "^/(interface|quick-start|schematic|pcb|tools)?$|^/(schematic|pcb|tools)/" },
      { text: "Design Notes", link: "/design/collaboration", activeMatch: "/design/" },
      { text: "ziroeda.com", link: "https://www.ziroeda.com" },
      { text: "Launch App", link: "https://www.ziroeda.com" },
    ],

    // A single tree that applies to every page — the EasyEDA pattern.
    sidebar: [
      {
        text: "Introduction",
        collapsed: false,
        items: [
          { text: "Introduction to Ziro Designer", link: "/" },
          { text: "The Interface", link: "/interface" },
          { text: "Quick Start", link: "/quick-start" },
        ],
      },
      {
        text: "Schematic Capture",
        collapsed: true,
        items: [
          { text: "Overview", link: "/schematic/" },
          { text: "Drawing a Schematic", link: "/schematic/drawing" },
          { text: "Symbols & Libraries", link: "/schematic/symbols" },
        ],
      },
      {
        text: "PCB Layout",
        collapsed: true,
        items: [
          { text: "Overview", link: "/pcb/" },
          { text: "Placing Footprints", link: "/pcb/placement" },
          { text: "Routing & Vias", link: "/pcb/routing" },
        ],
      },
      {
        text: "Tools",
        collapsed: true,
        items: [
          { text: "Gerber Viewer", link: "/tools/gerber-viewer" },
          { text: "Calculators", link: "/tools/calculators" },
          { text: "Image Converter", link: "/tools/image-converter" },
        ],
      },
      {
        text: "Design Notes",
        collapsed: true,
        items: [
          { text: "Real-time Collaboration", link: "/design/collaboration" },
        ],
      },
    ],

    outline: { level: [2, 3], label: "On this page" },

    socialLinks: [
      { icon: "github", link: "https://github.com/ZiroEDA/ziro-designer" },
    ],

    search: { provider: "local" },

    editLink: {
      pattern:
        "https://github.com/ZiroEDA/ziro-designer/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    lastUpdated: {
      text: "Last updated",
      formatOptions: { dateStyle: "medium" },
    },

    footer: {
      message: "Released under the GPL-3.0-or-later License.",
      copyright: "© ZIRO EDA · Ziro Designer",
    },

    docFooter: {
      prev: "Previous",
      next: "Next",
    },
  },
});
