-- Cada tipo da folha na sua categoria.
--
-- A leva passada deu uma categoria a folha inteira, e isso responde "quanto
-- custa a folha". A pergunta seguinte -- a que se faz depois de olhar esse
-- numero -- e quanto foi salario, quanto foi adiantamento, quanto foram as
-- ferias. Com tudo em "Salarios" ela nao tem resposta.
--
-- A categoria geral continua existindo e vira o padrao: tipo sem categoria
-- propria cai nela, e quem nao quiser esse detalhe nao precisa criar nada.

ALTER TABLE "config_financeira" ADD COLUMN "categoria_salario_id" TEXT;
ALTER TABLE "config_financeira" ADD COLUMN "categoria_ferias_id" TEXT;
ALTER TABLE "config_financeira" ADD COLUMN "categoria_adiantamento_id" TEXT;
ALTER TABLE "config_financeira" ADD COLUMN "categoria_bonus_id" TEXT;

ALTER TABLE "config_financeira"
  ADD CONSTRAINT "config_financeira_categoria_salario_id_fkey"
  FOREIGN KEY ("categoria_salario_id") REFERENCES "categorias_despesa"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "config_financeira"
  ADD CONSTRAINT "config_financeira_categoria_ferias_id_fkey"
  FOREIGN KEY ("categoria_ferias_id") REFERENCES "categorias_despesa"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "config_financeira"
  ADD CONSTRAINT "config_financeira_categoria_adiantamento_id_fkey"
  FOREIGN KEY ("categoria_adiantamento_id") REFERENCES "categorias_despesa"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "config_financeira"
  ADD CONSTRAINT "config_financeira_categoria_bonus_id_fkey"
  FOREIGN KEY ("categoria_bonus_id") REFERENCES "categorias_despesa"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- As quatro categorias tem de existir -- nao adianta apontar para o que nao ha.
--
-- A que ja existe com o nome certo e reaproveitada (nesta base, "Salarios" e
-- "Adiantamento" ja estao la); o que faltar nasce aqui, **dentro da mesma
-- categoria-mae da atual categoria da folha**. Se "Salarios" mora em "Custo com
-- Pessoal", "Ferias" e "Bonus" nascem ao lado dela, e nao soltas no fim da
-- lista: e no grupo que elas se somam.
DO $$
DECLARE
  mae_id  TEXT;
  cat_id  TEXT;
  alvo    RECORD;
BEGIN
  SELECT c."pai_id" INTO mae_id
    FROM "config_financeira" f
    JOIN "categorias_despesa" c ON c."id" = f."categoria_folha_id"
   WHERE f."id" = 1;

  FOR alvo IN
    SELECT * FROM (VALUES
      ('categoria_salario_id',      'Salários',     ARRAY['salarios','salários','salario','salário']),
      ('categoria_ferias_id',       'Férias',       ARRAY['ferias','férias']),
      ('categoria_adiantamento_id', 'Adiantamento', ARRAY['adiantamento','adiantamentos']),
      ('categoria_bonus_id',        'Bônus',        ARRAY['bonus','bônus'])
    ) AS t(coluna, nome, apelidos)
  LOOP
    SELECT "id" INTO cat_id
      FROM "categorias_despesa"
     WHERE lower("nome") = ANY(alvo.apelidos)
     ORDER BY "created_at" ASC
     LIMIT 1;

    IF cat_id IS NULL THEN
      INSERT INTO "categorias_despesa"
        ("id", "nome", "ativa", "ordem", "pai_id", "created_at", "updated_at")
      VALUES (
        md5(random()::text || clock_timestamp()::text || alvo.nome)::uuid::text,
        alvo.nome, true,
        COALESCE((SELECT MAX("ordem") FROM "categorias_despesa"), 0) + 1,
        mae_id, now(), now()
      )
      RETURNING "id" INTO cat_id;
    END IF;

    EXECUTE format('UPDATE "config_financeira" SET %I = $1 WHERE "id" = 1', alvo.coluna)
      USING cat_id;
  END LOOP;
END $$;

-- E o que ja foi etiquetado pela automacao muda de fatia.
--
-- Duas travas, e cada uma protege uma coisa diferente:
--
--   * `classificado_por IS NULL` -- so o que a propria automacao pos. Etiqueta
--     escolhida a mao fica onde esta: e justamente o caso dos adiantamentos que
--     alguem ja tinha mandado para "Adiantamento" antes disto existir.
--   * `categoria_id = categoria_folha_id` -- so o que esta na etiqueta geral. O
--     que ja foi para outro lugar nao volta.
UPDATE "classificacoes_conta" cc
SET "categoria_id" = CASE c."tipo"
      WHEN 'SALARIO'      THEN f."categoria_salario_id"
      WHEN 'FERIAS'       THEN f."categoria_ferias_id"
      WHEN 'ADIANTAMENTO' THEN f."categoria_adiantamento_id"
      WHEN 'BONUS'        THEN f."categoria_bonus_id"
    END,
    "updated_at" = now()
FROM "contas_pagar" c, "config_financeira" f
WHERE f."id" = 1
  AND c."id_fn_apagar_ixc" = cc."id_fn_apagar"
  AND c."origem" = 'FOLHA'
  AND c."tipo" IN ('SALARIO', 'FERIAS', 'ADIANTAMENTO', 'BONUS')
  AND cc."classificado_por" IS NULL
  AND cc."categoria_id" = f."categoria_folha_id"
  AND CASE c."tipo"
        WHEN 'SALARIO'      THEN f."categoria_salario_id"
        WHEN 'FERIAS'       THEN f."categoria_ferias_id"
        WHEN 'ADIANTAMENTO' THEN f."categoria_adiantamento_id"
        WHEN 'BONUS'        THEN f."categoria_bonus_id"
      END IS NOT NULL;
