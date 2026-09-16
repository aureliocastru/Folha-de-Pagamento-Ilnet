-- O galão de 200 litros que abastece as máquinas, e a máquina que se mede em
-- horas. O que entra no galão vem do posto, com nota; o que sai dele vai para
-- a máquina, sem nota — o dinheiro já saiu na compra.
ALTER TYPE "TipoVeiculo" ADD VALUE 'GALAO' BEFORE 'OUTRO';

-- CreateEnum
CREATE TYPE "Combustivel" AS ENUM ('DIESEL_S500', 'DIESEL_S10', 'GASOLINA', 'ETANOL', 'ARLA');

-- AlterTable
ALTER TABLE "veiculos" ADD COLUMN     "combustivel" "Combustivel",
ADD COLUMN     "capacidade_litros" INTEGER;

-- AlterTable
ALTER TABLE "abastecimentos" ALTER COLUMN "km" DROP NOT NULL,
ADD COLUMN     "horimetro" INTEGER,
ADD COLUMN     "litros" DECIMAL(10,2),
ADD COLUMN     "galao_id" TEXT;

-- CreateIndex
CREATE INDEX "abastecimentos_galao_id_data_idx" ON "abastecimentos"("galao_id", "data");

-- AddForeignKey
ALTER TABLE "abastecimentos" ADD CONSTRAINT "abastecimentos_galao_id_fkey" FOREIGN KEY ("galao_id") REFERENCES "veiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
