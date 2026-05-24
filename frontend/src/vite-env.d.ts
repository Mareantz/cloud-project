/// <reference types="vite/client" />

// Type-safe access to Vite environment variables.
// Add new VITE_* variables here as you introduce them.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
