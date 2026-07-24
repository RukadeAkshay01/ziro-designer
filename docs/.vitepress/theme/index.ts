import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import Layout from './Layout.vue';
import './custom.css';

// Ziro Designer docs theme — stock VitePress theme wrapped with our Layout,
// which adds the ziroeda.com announcement banner and a branded 404 (via the
// default theme's #not-found slot), plus brand tokens in custom.css.
export default {
  extends: DefaultTheme,
  Layout,
} satisfies Theme;
