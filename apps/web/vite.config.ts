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

export default defineConfig({
  plugins: [react()],
  define: { __VERSAO__: JSON.stringify(VERSAO) },
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
