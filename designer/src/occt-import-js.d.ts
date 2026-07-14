declare module 'occt-import-js' {
  /** Emscripten module factory for the OpenCascade WASM kernel. */
  const init: (opts?: { locateFile?: (file: string) => string }) => Promise<unknown>;
  export default init;
}

declare module 'occt-import-js/dist/occt-import-js.wasm?url' {
  const url: string;
  export default url;
}
