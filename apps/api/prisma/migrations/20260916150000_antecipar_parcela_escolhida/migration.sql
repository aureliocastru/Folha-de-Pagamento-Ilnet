-- A antecipação deixou de ser automática: cada parcela adiantada é lançada à
-- mão, com o valor do boleto com desconto, e vira uma linha aqui.
ALTER TABLE "despesas_recorrentes" DROP COLUMN "antecipadas_por_mes",
DROP COLUMN "valor_da_antecipada";

-- CreateTable
CREATE TABLE "parcelas_antecipadas" (
    "id" TEXT NOT NULL,
    "recorrente_id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "valor_de_tabela" DECIMAL(14,2) NOT NULL,
    "conta_id" TEXT,
    "id_fn_apagar_ixc" INTEGER,
    "data" TIMESTAMP(3) NOT NULL,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parcelas_antecipadas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parcelas_antecipadas_recorrente_id_numero_key" ON "parcelas_antecipadas"("recorrente_id", "numero");

-- AddForeignKey
ALTER TABLE "parcelas_antecipadas" ADD CONSTRAINT "parcelas_antecipadas_recorrente_id_fkey" FOREIGN KEY ("recorrente_id") REFERENCES "despesas_recorrentes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
