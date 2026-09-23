-- O maior id de lançamento que o caixa tinha no IXC quando o fechamento foi
-- assinado. O que vier acima dele com data do período já fechado foi lançado
-- depois da contagem, e entra na gaveta seguinte.
ALTER TABLE "fechamentos_caixa" ADD COLUMN "ultimo_id_lancamento" INTEGER;

-- Os fechamentos que já existem não guardaram esse número. A melhor aproximação
-- é a última saída conferida até a hora de assinar: fechar exige todas as
-- saídas do período conferidas, então o que veio depois dela (e não foi
-- conferido até ali) chegou depois do fechamento.
UPDATE "fechamentos_caixa" f
SET "ultimo_id_lancamento" = (
  SELECT MAX(c."id_lancamento_ixc")
  FROM "conferencias_caixa" c
  WHERE c."caixa_id" = f."caixa_id"
    AND c."conferido" = TRUE
    AND c."conferido_em" <= f."created_at"
);
