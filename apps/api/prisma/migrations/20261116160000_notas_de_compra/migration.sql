-- A nota fiscal de compra lancada pelo almoxarife: os produtos entram no IXC
-- na hora, e as parcelas ficam aqui ate o Contas a Pagar confirmar.

-- CreateTable
CREATE TABLE "notas_de_compra" (
    "id" TEXT NOT NULL,
    "numero_nota" TEXT NOT NULL,
    "id_fornecedor_ixc" INTEGER NOT NULL,
    "fornecedor_nome" TEXT NOT NULL,
    "data_emissao" DATE NOT NULL,
    "almox_id" INTEGER NOT NULL,
    "almoxarifado" TEXT NOT NULL,
    "valor_total" DECIMAL(14,2) NOT NULL,
    "id_entrada_ixc" INTEGER NOT NULL,
    "compra_aberta" TEXT,
    "itens" JSONB NOT NULL DEFAULT '[]',
    "parcelas" JSONB NOT NULL DEFAULT '[]',
    "situacao" TEXT NOT NULL DEFAULT 'AGUARDANDO',
    "lancada_por" TEXT NOT NULL,
    "decidida_por" TEXT,
    "decidida_em" TIMESTAMP(3),
    "motivo_da_recusa" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notas_de_compra_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notas_de_compra_situacao_idx" ON "notas_de_compra"("situacao");

-- CreateIndex
CREATE INDEX "notas_de_compra_id_fornecedor_ixc_numero_nota_idx" ON "notas_de_compra"("id_fornecedor_ixc", "numero_nota");
