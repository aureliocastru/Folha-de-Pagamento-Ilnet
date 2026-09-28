-- O pagamento de férias passa a saber de quais férias ele é. Até aqui a
-- ligação era pelo mês (a conta FERIAS da competência), e isso não serve para
-- férias pagas adiantadas, antes do mês em que começam.
ALTER TABLE "contas_pagar" ADD COLUMN "ferias_marcada_id" TEXT;

ALTER TABLE "contas_pagar"
  ADD CONSTRAINT "contas_pagar_ferias_marcada_id_fkey"
  FOREIGN KEY ("ferias_marcada_id") REFERENCES "ferias_marcadas"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "contas_pagar_ferias_marcada_id_idx"
  ON "contas_pagar"("ferias_marcada_id");
