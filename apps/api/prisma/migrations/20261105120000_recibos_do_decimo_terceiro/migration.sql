-- O recibo do 13º salário: o lote diz de que parcela é (null = a folha do
-- mês) e guarda os bônus que lançou, para o desfazer poder tirá-los.
ALTER TABLE "lotes_de_recibos" ADD COLUMN "parcela_do_13" INTEGER;
ALTER TABLE "lotes_de_recibos" ADD COLUMN "bonus_do_13" JSONB;
