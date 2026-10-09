-- Contabilidade: o pacote do mês para o escritório de contabilidade.

CREATE TABLE "pacotes_contabeis" (
    "id" TEXT NOT NULL,
    "de" DATE NOT NULL,
    "ate" DATE NOT NULL,
    "leitura_em" TIMESTAMP(3),
    "leitura_fim_em" TIMESTAMP(3),
    "baixado_em" TIMESTAMP(3),
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pacotes_contabeis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pacotes_contabeis_de_ate_key" ON "pacotes_contabeis"("de", "ate");

CREATE TABLE "itens_do_pacote" (
    "id" TEXT NOT NULL,
    "pacote_id" TEXT NOT NULL,
    "item" INTEGER NOT NULL,
    "chave" TEXT NOT NULL DEFAULT '',
    "nao_teve" BOOLEAN NOT NULL DEFAULT false,
    "observacao" TEXT,
    "dados" JSONB,
    "resumo" JSONB,
    "avisos" JSONB,
    "lido_em" TIMESTAMP(3),
    "erro" TEXT,
    "marcado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "itens_do_pacote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "itens_do_pacote_pacote_id_item_chave_key" ON "itens_do_pacote"("pacote_id", "item", "chave");

ALTER TABLE "itens_do_pacote"
  ADD CONSTRAINT "itens_do_pacote_pacote_id_fkey"
  FOREIGN KEY ("pacote_id") REFERENCES "pacotes_contabeis"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "arquivos_contabeis" (
    "id" TEXT NOT NULL,
    "pacote_id" TEXT,
    "item" INTEGER NOT NULL,
    "chave" TEXT NOT NULL DEFAULT '',
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "conteudo" BYTEA NOT NULL,
    "vigente_desde" DATE,
    "encerrado_em" DATE,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arquivos_contabeis_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "arquivos_contabeis_pacote_id_item_idx" ON "arquivos_contabeis"("pacote_id", "item");
CREATE INDEX "arquivos_contabeis_item_encerrado_em_idx" ON "arquivos_contabeis"("item", "encerrado_em");

ALTER TABLE "arquivos_contabeis"
  ADD CONSTRAINT "arquivos_contabeis_pacote_id_fkey"
  FOREIGN KEY ("pacote_id") REFERENCES "pacotes_contabeis"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "configuracao_contabil" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "papel_das_contas" JSONB NOT NULL DEFAULT '{}',
    "caixas" JSONB NOT NULL DEFAULT '[]',
    "lucros" JSONB NOT NULL DEFAULT '{}',
    "doacoes" JSONB NOT NULL DEFAULT '{}',
    "link" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracao_contabil_pkey" PRIMARY KEY ("id")
);
