import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Em dev, o frontend chama /api e o Vite faz proxy para a API (porta 3333).
// Em produção, o nginx do container faz o mesmo proxy.
/*
 * Quando esta versão foi montada, no horário daqui. Aparece no menu, embaixo do
 * nome: é por ela que se confere, no celular, se o app já pegou a versão nova —
 * o app da tela inicial do iPhone às vezes segue na velha, e sem isto não há
 * como saber qual das duas está aberta.
 */
const VERSAO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Fortaleza',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
  .format(new Date())
  .replace(', ', ' às ');

const BIBLIOTECAS_DE_BASE =
  /\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router|@tanstack\/[^/]+|axios)\//;

export default defineConfig({
  plugins: [react()],
  define: { __VERSAO__: JSON.stringify(VERSAO) },
  build: {
    rollupOptions: {
      output: {
        /*
         * As bibliotecas de base (React, rotas, consultas, axios) num pacote à
         * parte. Elas vinham dentro do pacote principal, que muda de nome a
         * cada versão — e sai versão quase todo dia: o celular baixava de novo
         * o React inteiro por causa de uma vírgula numa tela. Separadas, o
         * nome delas só muda quando a biblioteca muda, e o aparelho segue com
         * a cópia que já tem.
         *
         * O nome não pode começar com `index-`: é por esse nome que o
         * `AvisoDeVersaoNova` reconhece o pacote principal.
         */
        manualChunks(id) {
          if (BIBLIOTECAS_DE_BASE.test(id.replaceAll('\\', '/'))) return 'base';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:3333',
        changeOrigin: true,
      },
    },
  },
});
