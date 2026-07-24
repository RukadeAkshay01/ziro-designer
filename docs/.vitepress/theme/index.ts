import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import Layout from "./Layout.vue";
import "./custom.css";

// Ziro Designer docs theme — stock VitePress theme wrapped with our Layout
// (adds the ziroeda.com announcement banner) and brand tokens (custom.css).
export default {
  extends: DefaultTheme,
  Layout,
} satisfies Theme;
