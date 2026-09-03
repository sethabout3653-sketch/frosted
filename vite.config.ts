import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'disable-hosted-hmr-client',
        transformIndexHtml: {
          order: 'post',
          handler(html) {
            return html
              .replace(/<script[^>]+src=["']\/@vite\/client["'][^>]*><\/script>/g, '')
              .replace(/<script[^>]+src=["']\/@react-refresh["'][^>]*><\/script>/g, '')
              .replace(/<script type=["']module["'][^>]*>\s*import\s+["']\/@vite\/client["'];?\s*<\/script>/g, '')
          },
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: false,
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
