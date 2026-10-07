-- A conta dividida entre veículos: uma nota por carro, um pagamento só no IXC,
-- e a parte de cada veículo aqui, para a ficha dele somar só o que é dele.
CREATE TABLE "despesas_por_veiculo" (
    "id" TEXT NOT NULL,
    "conta_pagar_id" TEXT NOT NULL,
    "veiculo_id" TEXT NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "descricao" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "despesas_por_veiculo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "despesas_por_veiculo_conta_pagar_id_idx"
  ON "despesas_por_veiculo"("conta_pagar_id");

CREATE INDEX "despesas_por_veiculo_veiculo_id_idx"
  ON "despesas_por_veiculo"("veiculo_id");

ALTER TABLE "despesas_por_veiculo"
  ADD CONSTRAINT "despesas_por_veiculo_conta_pagar_id_fkey"
  FOREIGN KEY ("conta_pagar_id") REFERENCES "contas_pagar"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "despesas_por_veiculo"
  ADD CONSTRAINT "despesas_por_veiculo_veiculo_id_fkey"
  FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
