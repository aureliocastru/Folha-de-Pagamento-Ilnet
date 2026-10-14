-- Patrocínio: quem a ILNET patrocina, os contratos (assinados pelo link ou
-- escaneados) e os arquivos de cada um. O pagamento continua pela aba
-- Diaristas: cada patrocinado aponta para o cadastro de diarista por onde recebe.

-- CreateEnum
CREATE TYPE "OrigemDoContrato" AS ENUM ('LINK', 'ESCANEADO');

-- CreateTable
CREATE TABLE "patrocinados" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "projeto" TEXT,
    "cpf_cnpj" TEXT,
    "responsavel" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "instagram" TEXT,
    "cidade" TEXT,
    "valor_mensal" DECIMAL(14,2),
    "inicio" DATE,
    "fim" DATE,
    "observacoes" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "diarista_id" TEXT,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patrocinados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contratos_de_patrocinio" (
    "id" TEXT NOT NULL,
    "patrocinado_id" TEXT NOT NULL,
    "origem" "OrigemDoContrato" NOT NULL,
    "token" TEXT,
    "expira_em" TIMESTAMP(3),
    "texto" TEXT,
    "nome_patrocinado" TEXT,
    "cpf_patrocinado" TEXT,
    "projeto" TEXT,
    "valor_mensal" DECIMAL(14,2),
    "inicio" DATE,
    "fim" DATE,
    "empresa_nome" TEXT,
    "empresa_cnpj" TEXT,
    "assinatura_png" TEXT,
    "modo" "ModoAssinatura" NOT NULL DEFAULT 'DESENHADA',
    "nome_assinante" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "assinado_em" TIMESTAMP(3),
    "arquivo_nome" TEXT,
    "arquivo_tipo" TEXT,
    "arquivo_tamanho" INTEGER,
    "arquivo" BYTEA,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contratos_de_patrocinio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arquivos_do_patrocinado" (
    "id" TEXT NOT NULL,
    "patrocinado_id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "arquivo_nome" TEXT NOT NULL,
    "arquivo_tipo" TEXT NOT NULL,
    "arquivo_tamanho" INTEGER NOT NULL,
    "arquivo" BYTEA NOT NULL,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arquivos_do_patrocinado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patrocinados_diarista_id_key" ON "patrocinados"("diarista_id");

-- CreateIndex
CREATE INDEX "patrocinados_ativo_idx" ON "patrocinados"("ativo");

-- CreateIndex
CREATE INDEX "patrocinados_nome_idx" ON "patrocinados"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "contratos_de_patrocinio_token_key" ON "contratos_de_patrocinio"("token");

-- CreateIndex
CREATE INDEX "contratos_de_patrocinio_patrocinado_id_idx" ON "contratos_de_patrocinio"("patrocinado_id");

-- CreateIndex
CREATE INDEX "arquivos_do_patrocinado_patrocinado_id_idx" ON "arquivos_do_patrocinado"("patrocinado_id");

-- AddForeignKey
ALTER TABLE "patrocinados" ADD CONSTRAINT "patrocinados_diarista_id_fkey" FOREIGN KEY ("diarista_id") REFERENCES "diaristas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos_de_patrocinio" ADD CONSTRAINT "contratos_de_patrocinio_patrocinado_id_fkey" FOREIGN KEY ("patrocinado_id") REFERENCES "patrocinados"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arquivos_do_patrocinado" ADD CONSTRAINT "arquivos_do_patrocinado_patrocinado_id_fkey" FOREIGN KEY ("patrocinado_id") REFERENCES "patrocinados"("id") ON DELETE CASCADE ON UPDATE CASCADE;

