-- Abastecimento sem valor: quem abastece lanca so o km e a foto da nota, e o
-- administrador poe o valor na conferencia. Continua sendo controle -- nada se
-- paga por aqui.

ALTER TABLE "abastecimentos" ALTER COLUMN "valor" DROP NOT NULL;

ALTER TABLE "abastecimentos" ADD COLUMN "conferido_por" TEXT;
ALTER TABLE "abastecimentos" ADD COLUMN "conferido_em" TIMESTAMP(3);

-- Os que ja entraram com valor ficam dados por conferidos: o valor veio de quem
-- abasteceu, e pedir de novo encheria a fila com o que ja esta certo.
UPDATE "abastecimentos"
   SET "conferido_por" = "lancado_por", "conferido_em" = "created_at"
 WHERE "valor" IS NOT NULL;
