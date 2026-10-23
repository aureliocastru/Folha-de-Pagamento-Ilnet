-- O "A receber na folha" que um lote de recibos trocou: o líquido de cada
-- recibo vira o valor da folha de quem tem carteira assinada, e o desfazer do
-- lote devolve o valor de antes.
ALTER TABLE "lotes_de_recibos" ADD COLUMN "a_receber_trocado" JSONB;
