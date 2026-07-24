<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import NotFound from "./NotFound.vue";

const { Layout } = DefaultTheme;
</script>

<template>
  <Layout>
    <!-- ziroeda.com-style announcement bar, pinned above the nav -->
    <template #layout-top>
      <div class="zx-banner">
        ZIRO Designer public beta is here.
        <a href="https://www.ziroeda.com" target="_blank" rel="noreferrer"
          >Launch the app →</a
        >
      </div>
    </template>

    <!-- Branded 404 for unknown URLs -->
    <template #not-found>
      <NotFound />
    </template>
  </Layout>
</template>
