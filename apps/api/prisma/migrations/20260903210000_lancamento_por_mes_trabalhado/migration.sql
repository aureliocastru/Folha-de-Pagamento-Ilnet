-- O avulso passa a ser guardado pelo mês TRABALHADO, e não pelo mês da folha.
--
-- Um mês de trabalho é pago em dois pedaços: o adiantamento no dia 25 do
-- próprio mês e o saldo no quinto dia do mês seguinte. Guardando o mês do
-- pagamento, o campo tinha de escolher um dos dois — e era o que fazia a tela
-- da pessoa pedir um mês nos lançamentos e outro, ao lado, nas vendas.
--
-- O que já está gravado está na régua antiga (mês da folha), e a nova é sempre
-- o mês anterior a ele: o avulso de "2026-08" foi pago na folha de agosto, que
-- é o trabalho de julho. Sem esta conversão, os 12 avulsos de agosto que já
-- foram pagos voltariam a entrar na folha de setembro.
--
-- Determinística e reversível: para desfazer, somar um mês em vez de subtrair.
UPDATE "lancamentos_fixos"
SET "competencia" = to_char(
      to_date("competencia" || '-01', 'YYYY-MM-DD') - interval '1 month',
      'YYYY-MM'
    )
WHERE "competencia" IS NOT NULL;
