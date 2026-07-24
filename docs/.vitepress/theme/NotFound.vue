<script setup lang="ts">
import { withBase } from 'vitepress';
</script>

<template>
  <div class="zx-404">
    <span class="eyebrow">Error 404</span>
    <div class="code">404</div>
    <h1>This page doesn't exist.</h1>
    <p>
      The page you were looking for may have moved, or the link might be broken.
      Let's get you back on track.
    </p>
    <div class="btns">
      <a class="btn primary" :href="withBase('/')">← Back to docs</a>
      <a
        class="btn"
        href="https://designer.ziroeda.com"
        target="_blank"
        rel="noopener"
        >Launch Ziro Designer →</a
      >
    </div>
  </div>
</template>

<style scoped>
.zx-404 {
  min-height: calc(100vh - var(--vp-nav-height) - var(--vp-layout-top-height, 0px));
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  max-width: 720px;
  margin: 0 auto;
  padding: 40px 48px 80px;
}
.eyebrow {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--zx-gold-lite);
  margin-bottom: 24px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.eyebrow::before {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--zx-gold);
  box-shadow: 0 0 0 4px var(--zx-accent-line);
}
.code {
  font-family: var(--zx-font-head);
  font-size: clamp(80px, 16vw, 180px);
  font-weight: 300;
  line-height: 0.9;
  letter-spacing: -0.05em;
  color: var(--vp-c-text-1);
  margin-bottom: 24px;
}
.zx-404 h1 {
  font-family: var(--zx-font-head);
  font-size: clamp(24px, 4vw, 40px);
  font-weight: 400;
  letter-spacing: -0.03em;
  color: var(--vp-c-text-1);
  margin-bottom: 20px;
  border: none;
  padding: 0;
}
.zx-404 p {
  font-size: 15px;
  color: var(--vp-c-text-2);
  line-height: 1.75;
  max-width: 480px;
  margin-bottom: 44px;
}
.btns {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.btn {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vp-c-text-2);
  text-decoration: none;
  padding: 13px 24px;
  border: 1px solid var(--vp-c-divider);
  transition: all 0.25s;
}
.btn:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-brand-1);
  background: var(--zx-accent-dim);
}
.btn.primary {
  color: var(--vp-c-brand-1);
  border-color: var(--zx-accent-line);
  background: var(--zx-accent-dim);
}
.btn.primary:hover {
  color: var(--vp-c-text-1);
  border-color: var(--zx-gold);
}
@media (max-width: 768px) {
  .zx-404 {
    padding: 40px 24px 64px;
  }
}
</style>
