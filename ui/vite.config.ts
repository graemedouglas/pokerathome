import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@pokerathome/schema': path.resolve(__dirname, '../schema/src/index.ts'),
    },
  },
  server: {
    open: true,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
})
