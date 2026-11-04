# Backend NestJS + Prisma. Contexto de build = raiz do repositório.
FROM node:22-alpine
WORKDIR /app

# LibreOffice, para guardar o Word já convertido em PDF (ver
# `src/rh/conversao-pdf.service.ts`).
#
# É a camada mais pesada da imagem, e vem primeiro de propósito: mudança de
# código não a reconstrói. Só Writer e Calc — o resto da suíte (Impress, Draw,
# Base) não converte nada que esta estante guarde.
#
# As fontes não são enfeite: sem Liberation, o LibreOffice troca Arial e Times
# New Roman por qualquer coisa que ache, e a proposta que ia em duas páginas vai
# em três com a paginação toda deslocada. Liberation tem as mesmas métricas das
# fontes da Microsoft, que é o que faz o PDF sair com a quebra de página do
# documento original.
#
# A API funciona sem nada disto: sem o binário, a conversão devolve "o
# LibreOffice não está instalado no servidor" e o arquivo é guardado como veio.
RUN apk add --no-cache \
      libreoffice-writer \
      libreoffice-calc \
      font-liberation \
      font-dejavu \
      font-noto

# Instala dependências do workspace da API (só apps/api é copiado, então o
# workspace resolve apenas @folha/api).
#
# `--omit=optional` existe por um motivo só: o pdfjs traz o @napi-rs/canvas como
# dependência opcional — 37 MB de binário nativo compilado para desenhar página,
# coisa que esta API nunca faz. Tirar o pdf-parse não tirou esse binário da
# imagem; só adiou o carregamento dele para a primeira leitura de guia, e é o
# único código nativo nesse caminho — quem morre ali derruba o processo inteiro,
# porque o pdfjs o carrega por conta própria, fora do nosso try/catch. Sem ele
# instalado, o pdfjs registra um aviso ("Cannot load @napi-rs/canvas") e segue em
# JavaScript puro: o que ele procurava naquele pacote já é montado em
# `src/impostos/pdf.ts`, antes do import.
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
RUN npm install --omit=optional

# O cliente do Postgres, para o backup (ver `src/backup/`). Várias versões lado
# a lado, cada uma em /usr/libexec/postgresqlNN: o pg_dump precisa ser da mesma
# versão do banco, e o Postgres do EasyPanel pode ser qualquer uma. A API escolhe
# a que serve na hora do backup. Versão que o Alpine desta imagem não tem é
# pulada; nenhuma instalada derruba o build, em vez de o botão falhar no dia.
#
# Mora depois do `npm install` de propósito: entrou quando o disco do servidor
# estava cheio, e antes dele obrigaria a refazer a camada das dependências — a
# maior da imagem depois do LibreOffice.
RUN for v in 13 14 15 16 17 18 19; do \
      apk add --no-cache "postgresql$v-client" >/dev/null 2>&1 && echo "pg_dump $v"; \
    done; \
    ls /usr/libexec/postgresql*/pg_dump

# Código-fonte + geração do Prisma Client + build
COPY apps/api ./apps/api
WORKDIR /app/apps/api
RUN npx prisma generate && npm run build

ENV NODE_ENV=production
EXPOSE 3333

# Aplica migrações pendentes e sobe a API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
