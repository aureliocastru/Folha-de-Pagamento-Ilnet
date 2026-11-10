-- Patrocínio: fixo em dinheiro, fixo em desconto na mensalidade, ou avulso; e
-- a nota de recebimento que o patrocinado assina a cada pagamento, com a baixa
-- de quem a confere.

-- CreateEnum
CREATE TYPE "TipoDePatrocinio" AS ENUM ('FIXO', 'DESCONTO', 'AVULSO');

-- Os patrocinados de antes eram todos fixos em dinheiro.
ALTER TABLE "patrocinados" ADD COLUMN "tipo" "TipoDePatrocinio" NOT NULL DEFAULT 'FIXO';

-- O contrato guarda o tipo do dia do link. Os de antes ficam vazios (= fixo).
ALTER TABLE "contratos_de_patrocinio" ADD COLUMN "tipo" "TipoDePatrocinio";

-- CreateTable
CREATE TABLE "notas_de_recebimento" (
    "id" TEXT NOT NULL,
    "patrocinado_id" TEXT NOT NULL,
    "id_fn_apagar" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "referente" TEXT NOT NULL,
    "vencimento" DATE,
    "pago_em" DATE,
    "nome_patrocinado" TEXT NOT NULL,
    "cpf_patrocinado" TEXT,
    "projeto" TEXT,
    "empresa_nome" TEXT NOT NULL,
    "empresa_cnpj" TEXT,
    "assinatura_png" TEXT,
    "assinado_em" TIMESTAMP(3),
    "modo" "ModoAssinatura" NOT NULL DEFAULT 'DESENHADA',
    "nome_assinante" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "baixada_em" TIMESTAMP(3),
    "baixada_por" TEXT,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notas_de_recebimento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notas_de_recebimento_id_fn_apagar_key" ON "notas_de_recebimento"("id_fn_apagar");

-- CreateIndex
CREATE UNIQUE INDEX "notas_de_recebimento_token_key" ON "notas_de_recebimento"("token");

-- CreateIndex
CREATE INDEX "notas_de_recebimento_patrocinado_id_idx" ON "notas_de_recebimento"("patrocinado_id");

-- CreateIndex
CREATE INDEX "notas_de_recebimento_assinado_em_baixada_em_idx" ON "notas_de_recebimento"("assinado_em", "baixada_em");

-- AddForeignKey
ALTER TABLE "notas_de_recebimento" ADD CONSTRAINT "notas_de_recebimento_patrocinado_id_fkey" FOREIGN KEY ("patrocinado_id") REFERENCES "patrocinados"("id") ON DELETE CASCADE ON UPDATE CASCADE;
