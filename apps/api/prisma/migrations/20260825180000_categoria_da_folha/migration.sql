-- Todo pagamento da folha nasce etiquetado como salario.
--
-- A folha gera dezenas de contas por mes -- salario, ferias, adiantamento,
-- bonus --, e nenhuma delas passa pela tela de classificar: quem gera a folha
-- nao abre conta por conta para escolher categoria. O resultado e que o maior
-- gasto da empresa era justamente o que ficava fora de todo grafico por
-- categoria, e a categoria "Salarios" mostrava quatro contas quando deveria
-- mostrar centenas.
--
-- Sao tres passos aqui: a coluna que diz qual e a etiqueta da folha, a
-- garantia de que a categoria existe, e o acerto do que ja foi pago.

-- 1) Qual categoria a folha usa. Fica na configuracao, e nao no codigo, porque
--    o nome dela e do usuario: renomear "Salarios" nao pode quebrar nada.
ALTER TABLE "config_financeira" ADD COLUMN "categoria_folha_id" TEXT;

ALTER TABLE "config_financeira"
  ADD CONSTRAINT "config_financeira_categoria_folha_id_fkey"
  FOREIGN KEY ("categoria_folha_id") REFERENCES "categorias_despesa"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) A categoria tem de existir. Nesta base ela ja existe ("Salarios"); num
--    banco novo, nasce aqui. O nome sai com acento porque e assim que ele e
--    escrito -- e a procura abaixo aceita as duas grafias, para nao criar uma
--    segunda ao lado da que ja esta em uso.
INSERT INTO "categorias_despesa" ("id", "nome", "ativa", "ordem", "created_at", "updated_at")
SELECT
  md5(random()::text || clock_timestamp()::text)::uuid::text,
  'Salários', true,
  COALESCE((SELECT MAX("ordem") FROM "categorias_despesa"), 0) + 1,
  now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "categorias_despesa"
  WHERE lower("nome") IN ('salarios', 'salários', 'salario', 'salário')
);

-- 3) A configuracao aponta para ela.
UPDATE "config_financeira"
SET "categoria_folha_id" = (
  SELECT "id" FROM "categorias_despesa"
  WHERE lower("nome") IN ('salarios', 'salários', 'salario', 'salário')
  ORDER BY "created_at" ASC
  LIMIT 1
)
WHERE "categoria_folha_id" IS NULL;

-- 4) O que ja foi pago.
--
-- Etiqueta as contas da folha que ja foram ao IXC e ainda nao tem classificacao
-- nenhuma. `ON CONFLICT DO NOTHING` e o que protege quem ja foi classificado a
-- mao: escolha de gente nao se sobrescreve por migracao.
--
-- Diaria e avulso ficam de fora de proposito. A diaria e de diarista, nao de
-- funcionario, e o avulso ja tem seu proprio campo de categoria na tela em que
-- e lancado -- carimbar "Salarios" neles seria trocar uma informacao melhor por
-- uma pior.
INSERT INTO "classificacoes_conta" ("id", "id_fn_apagar", "categoria_id", "created_at", "updated_at")
SELECT
  md5(random()::text || clock_timestamp()::text || c."id")::uuid::text,
  c."id_fn_apagar_ixc",
  cfg."categoria_folha_id",
  now(), now()
FROM "contas_pagar" c
CROSS JOIN (
  SELECT "categoria_folha_id" FROM "config_financeira" WHERE "id" = 1
) cfg
WHERE cfg."categoria_folha_id" IS NOT NULL
  AND c."origem" = 'FOLHA'
  AND c."tipo" IN ('SALARIO', 'FERIAS', 'ADIANTAMENTO', 'BONUS')
  AND c."id_fn_apagar_ixc" IS NOT NULL
ON CONFLICT ("id_fn_apagar") DO NOTHING;
