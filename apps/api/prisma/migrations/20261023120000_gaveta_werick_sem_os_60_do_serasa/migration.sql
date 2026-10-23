-- Os R$ 60,00 do Serasa que saíram da gaveta do CX - Werick.
--
-- Dois recebimentos de R$ 30,00 de "Consulta no Serasa" (títulos 859814 e
-- 860257, de 06/06 e 09/06) foram baixados no CX - Werick quando eram de outro
-- caixa. Em 22/10 o dinheiro saiu da gaveta e os dois recebimentos foram
-- estornados no IXC.
--
-- A tela não viu: o estorno apaga a linha do recebimento, e linhas de junho
-- ficam antes de qualquer fechamento — a gaveta só soma do último fechamento
-- em diante. O saldo esperado ficou R$ 60,00 acima do dinheiro que existe.
--
-- O conserto é o mesmo do "Corrigir a contagem" da tela: o último fechamento
-- do caixa passa a ter R$ 60,00 a menos contados, e o período aberto parte
-- dali. O motivo vai na observação, para a falta não aparecer sem explicação.
--
-- Não mexe no fechamento contado depois das 17:27 de 22/10 (20:27 em UTC): essa
-- contagem já foi feita sem os R$ 60,00 na gaveta.
UPDATE "fechamentos_caixa" f
SET "saldo_contado" = COALESCE(f."saldo_contado", f."saldo_final") - 60,
    "observacao" = CONCAT_WS(
      E'\n',
      NULLIF(f."observacao", ''),
      'Contagem corrigida em -R$ 60,00 em 23/10/2026: dois recebimentos de ' ||
      'R$ 30,00 do Serasa de junho (títulos 859814 e 860257), baixados neste ' ||
      'caixa por engano, saíram da gaveta em 22/10 e foram estornados no IXC.'
    )
WHERE f."id" = (
    SELECT u."id"
    FROM "fechamentos_caixa" u
    WHERE u."caixa_id" = 23
    ORDER BY u."ate" DESC, u."created_at" DESC
    LIMIT 1
  )
  AND NOT (
    f."saldo_contado" IS NOT NULL
    AND f."created_at" > TIMESTAMP '2026-10-22 20:27:00'
  )
  AND COALESCE(f."saldo_contado", f."saldo_final") >= 60;
