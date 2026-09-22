/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // O tema escuro é ligado por classe no <html> (ver `lib/tema.ts`), e não só
  // pelo `prefers-color-scheme`: quem trabalha com estas telas o dia inteiro
  // escolhe o tema uma vez e ele fica — inclusive contrariando o sistema.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Acento da casa: o azul da logo da ilnet. Os tons foram tirados do
        // próprio arquivo — a onda vive em #4E8ACE e o "ilnet" desce de
        // #3294F0 a #13B2F9. `brand-500` é o tom da identidade; `brand-600` é
        // o dos botões sólidos, escuro o bastante para texto branco em cima
        // (contraste 5.0:1, acima do mínimo de 4.5:1).
        brand: {
          50: '#EBF5FE',
          100: '#D5EBFD',
          200: '#AAD6FB',
          300: '#74BCF8',
          400: '#3A9FF3',
          500: '#1490EE',
          600: '#0A72C4',
          700: '#0A5C9E',
          800: '#0D4C80',
          900: '#10406B',
          950: '#0A2847',
        },
        // Tinta de livro-caixa: do fundo da página ao texto forte.
        //
        // Os valores moram em variáveis CSS (ver `index.css`) porque a escala
        // inteira vira do avesso no tema escuro: `tinta-50` deixa de ser o
        // papel quase branco e passa a ser o fundo quase preto, `tinta-900`
        // deixa de ser o texto preto e passa a ser o texto quase branco. Assim
        // todo `text-tinta-700` já escrito nas telas continua querendo dizer a
        // mesma coisa — "texto de leitura" — nos dois temas, sem precisar de um
        // `dark:` em cada linha do app.
        tinta: {
          50: 'rgb(var(--tinta-50) / <alpha-value>)',
          100: 'rgb(var(--tinta-100) / <alpha-value>)',
          200: 'rgb(var(--tinta-200) / <alpha-value>)',
          300: 'rgb(var(--tinta-300) / <alpha-value>)',
          400: 'rgb(var(--tinta-400) / <alpha-value>)',
          500: 'rgb(var(--tinta-500) / <alpha-value>)',
          600: 'rgb(var(--tinta-600) / <alpha-value>)',
          700: 'rgb(var(--tinta-700) / <alpha-value>)',
          800: 'rgb(var(--tinta-800) / <alpha-value>)',
          900: 'rgb(var(--tinta-900) / <alpha-value>)',
        },
        /**
         * A superfície onde o conteúdo se apoia: cartão, campo, janela. Era
         * `bg-white` — que no escuro seria uma folha de papel acesa no meio da
         * tela.
         */
        papel: 'rgb(var(--papel) / <alpha-value>)',
        /**
         * O fundo do campo de digitar. Tem cor própria porque precisa se
         * distinguir do cartão e da página ao mesmo tempo — usar a de uma
         * delas faz o campo sumir na outra.
         */
        campo: 'rgb(var(--campo) / <alpha-value>)',
        'campo-foco': 'rgb(var(--campo-foco) / <alpha-value>)',
        /**
         * A tinta escura que não vira do avesso: barra lateral, botão de ação,
         * fundo da tela de módulos. São superfícies que já eram escuras no tema
         * claro e continuam escuras no escuro — com texto branco em cima nos
         * dois casos.
         */
        barra: 'rgb(var(--barra) / <alpha-value>)',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: [
          '"IBM Plex Sans"',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'sans-serif',
        ],
      },
      boxShadow: {
        // Sombras em camadas rasas: papel sobre papel, não caixa flutuante.
        card: '0 1px 2px -1px rgb(10 16 32 / 0.06), 0 4px 16px -8px rgb(10 16 32 / 0.10)',
        'card-hover':
          '0 2px 4px -2px rgb(10 16 32 / 0.08), 0 12px 28px -12px rgb(10 16 32 / 0.18)',
        aba: '0 1px 0 0 rgb(10 16 32 / 0.04)',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      keyframes: {
        surgir: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'none' },
        },
        crescer: {
          from: { transform: 'scaleY(0)' },
          to: { transform: 'scaleY(1)' },
        },
        // A gaveta do menu no celular: entra pela beirada de onde foi chamada.
        gaveta: {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'none' },
        },
      },
      animation: {
        surgir: 'surgir 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
        crescer: 'crescer 0.7s cubic-bezier(0.16, 1, 0.3, 1) both',
        gaveta: 'gaveta 0.22s cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
};
