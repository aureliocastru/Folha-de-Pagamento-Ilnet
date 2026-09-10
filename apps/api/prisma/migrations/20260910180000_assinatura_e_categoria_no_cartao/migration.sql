-- Assinaturas no cartao de credito.
--
-- O ChatGPT, o dominio, o software do mes: cobram o mesmo valor em toda
-- fatura, sem numero de parcelas e sem data para acabar. Lancadas como compra
-- de "12 vezes", mentiriam duas vezes -- parariam de aparecer no decimo
-- terceiro mes, e contariam como divida ja assumida o que ainda pode ser
-- cancelado amanha.
--
-- A assinatura cobra de `primeira_fatura` ate `ultima_fatura`; vazia, ela
-- continua ativa. Mudar o preco encerra a linha velha no mes anterior e abre
-- outra: as faturas ja lancadas continuam somando o que o banco cobrou.
ALTER TABLE "compras_no_cartao"
  ADD COLUMN "assinatura"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ultima_fatura" TEXT;

-- A categoria e de cada compra, e nao do cartao: na mesma fatura vem a moto,
-- a anuidade e o ChatGPT, e soma-los numa categoria so esconderia os tres. Os
-- relatorios dividem a fatura paga conforme a categoria das compras dentro.
ALTER TABLE "compras_no_cartao" ADD COLUMN "categoria_id" TEXT;

ALTER TABLE "compras_no_cartao"
  ADD CONSTRAINT "compras_no_cartao_categoria_id_fkey"
  FOREIGN KEY ("categoria_id") REFERENCES "categorias_despesa"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "compras_no_cartao_categoria_id_idx" ON "compras_no_cartao"("categoria_id");
