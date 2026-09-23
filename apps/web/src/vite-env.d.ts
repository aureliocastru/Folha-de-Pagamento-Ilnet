/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

/** Dia e hora em que esta versão foi montada ("23/09 às 16:05"). */
declare const __VERSAO__: string;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
