-- As parcelas que se pagam do fim para trás, e o veículo que o financiamento paga.
ALTER TABLE "despesas_recorrentes" ADD COLUMN     "parcelas_antecipadas" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "antecipadas_por_mes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "valor_da_antecipada" DECIMAL(14,2),
ADD COLUMN     "veiculo_id" TEXT;

-- CreateIndex
CREATE INDEX "despesas_recorrentes_veiculo_id_idx" ON "despesas_recorrentes"("veiculo_id");

-- AddForeignKey
ALTER TABLE "despesas_recorrentes" ADD CONSTRAINT "despesas_recorrentes_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
