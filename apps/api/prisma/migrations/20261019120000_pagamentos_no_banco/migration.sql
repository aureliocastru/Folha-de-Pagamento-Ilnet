-- Pagamentos mandados direto ao ModoBank pela API: o boleto ou o Pix de um
-- título do IXC, e o que o banco respondeu. Quando ele diz que pagou, o app dá
-- a baixa no IXC.

-- CreateEnum
CREATE TYPE "FormaNoBanco" AS ENUM ('BOLETO', 'PIX');

-- CreateEnum
CREATE TYPE "SituacaoNoBanco" AS ENUM ('ENVIANDO', 'NO_BANCO', 'AGUARDANDO_APROVACAO', 'PAGO', 'RECUSADO');

-- CreateTable
CREATE TABLE "pagamentos_no_banco" (
    "id" TEXT NOT NULL,
    "id_fn_apagar" INTEGER NOT NULL,
    "forma" "FormaNoBanco" NOT NULL,
    "destino" TEXT NOT NULL,
    "favorecido" TEXT,
    "valor" DECIMAL(14,2) NOT NULL,
    "chave" TEXT NOT NULL,
    "id_no_banco" TEXT,
    "situacao" "SituacaoNoBanco" NOT NULL DEFAULT 'ENVIANDO',
    "status_do_banco" TEXT,
    "erro" TEXT,
    "baixado_em" TIMESTAMP(3),
    "pago_em" TIMESTAMP(3),
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pagamentos_no_banco_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_no_banco_chave_key" ON "pagamentos_no_banco"("chave");

-- CreateIndex
CREATE INDEX "pagamentos_no_banco_id_fn_apagar_idx" ON "pagamentos_no_banco"("id_fn_apagar");

-- CreateIndex
CREATE INDEX "pagamentos_no_banco_situacao_idx" ON "pagamentos_no_banco"("situacao");
