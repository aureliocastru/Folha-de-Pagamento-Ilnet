-- AlterTable
ALTER TABLE "despesas_recorrentes" ADD COLUMN     "dia_do_vencimento" INTEGER,
ADD COLUMN     "total_parcelas" INTEGER,
ADD COLUMN     "parcelas_lancadas" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "parcelas_por_mes" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "lancadas_no_mes" INTEGER NOT NULL DEFAULT 0;
