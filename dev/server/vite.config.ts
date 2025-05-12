import { defineConfig } from 'vite';

export default defineConfig({
  // We are using Vite programmatically for a Node.js server environment,
  // so specific build outputs or public directories are not the primary concern here.
  // The main goal is to enable Vite's dev server for HMR of Lambda handlers.
  
  // Ensure Vite can process TypeScript files outside of a typical 'client' build
  appType: 'custom', // Or 'mpa', 'spa' - 'custom' is good for programmatic server usage

  // If your Lambda handlers or shared code are outside the 'local-server/src' directory
  // and you want Vite to process them, you might need to adjust 'root' or use 'resolve.alias'.
  // For now, assuming handlers might be resolved via absolute paths from the manifest.

  // Optional: Configure server options if needed, though we control the server programmatically.
  // server: {
  //   // e.g., port, host, https - not strictly necessary for our programmatic use case
  // },

  // Enable SSR-specific features if needed, especially for module loading
  ssr: {
    // You can list external CJS dependencies that Vite should not try to process
    // for SSR, if any. (e.g., some AWS SDK v2 components if used directly)
    // external: ['aws-sdk'],
    // noExternal: [/@aws-sdk\/.*/], // Ensure AWS SDK v3 modules are processed correctly by Vite
  },

  // If your shared code (like in ../shared) uses specific Node.js features
  // or has specific paths, you might need resolve.alias or optimizeDeps.include.
  resolve: {
    // alias: {
    //   // Example: if you have '@shared/': path.resolve(__dirname, '../shared')
    // },
  },
});
