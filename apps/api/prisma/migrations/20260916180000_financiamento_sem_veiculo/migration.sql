-- O financiamento deixa de depender do cadastro da frota: nem todo bem
-- financiado é veículo, e nem todo veículo pago está cadastrado. O que é fica
-- dito na descrição.
ALTER TABLE "despesas_recorrentes" ADD COLUMN "eh_financiamento" BOOLEAN NOT NULL DEFAULT false;

-- Os que já estavam na aba de financiamentos continuam nela.
UPDATE "despesas_recorrentes" SET "eh_financiamento" = true WHERE "veiculo_id" IS NOT NULL;

ALTER TABLE "despesas_recorrentes" DROP CONSTRAINT "despesas_recorrentes_veiculo_id_fkey";
DROP INDEX "despesas_recorrentes_veiculo_id_idx";
ALTER TABLE "despesas_recorrentes" DROP COLUMN "veiculo_id";
