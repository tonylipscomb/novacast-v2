/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PAIRING_API_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_PUBLIC_DOWNLOAD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
