-- As notas de uma conta paga de uma vez deixam de ser só de veículo: cada uma
-- ganha a sua categoria, e o veículo passa a ser opcional.
ALTER TABLE "despesas_por_veiculo" ALTER COLUMN "veiculo_id" DROP NOT NULL;

ALTER TABLE "despesas_por_veiculo" ADD COLUMN "categoria_id" TEXT;

CREATE INDEX "despesas_por_veiculo_categoria_id_idx"
  ON "despesas_por_veiculo"("categoria_id");

ALTER TABLE "despesas_por_veiculo"
  ADD CONSTRAINT "despesas_por_veiculo_categoria_id_fkey"
  FOREIGN KEY ("categoria_id") REFERENCES "categorias_despesa"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- A foto de cada nota fica guardada aqui também: com várias no mesmo título,
-- o IXC desta base não devolve uma por uma.
ALTER TABLE "fotos_da_nota" ADD COLUMN "parte_id" TEXT;

CREATE INDEX "fotos_da_nota_parte_id_idx" ON "fotos_da_nota"("parte_id");

ALTER TABLE "fotos_da_nota"
  ADD CONSTRAINT "fotos_da_nota_parte_id_fkey"
  FOREIGN KEY ("parte_id") REFERENCES "despesas_por_veiculo"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
