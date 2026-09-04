-- O item do catálogo pode nascer marcado na APR nova.
--
-- O técnico marcava, um a um, os mesmos quadradinhos em todo serviço: as três
-- normas e os riscos de quem sobe num poste ao lado da rede elétrica. É
-- repetição que não decide nada — e repetição sem decisão é o que faz o
-- preenchimento virar automático e a análise de risco virar carimbo.
--
-- Marcação de partida, e não resposta dada: continua desmarcável no toque, e
-- vale só para APR nova. Rascunho aberto ontem volta como foi deixado.
ALTER TABLE "itens_apr"
  ADD COLUMN "marcado_por_padrao" BOOLEAN NOT NULL DEFAULT false;

-- Os modelos que já estão no banco não passam mais pela semente — ela só cria
-- o que falta, e este modelo já existe. Sem os UPDATEs abaixo, a coluna nasceria
-- toda falsa em produção e o padrão só valeria para quem instalasse do zero.

-- Todas as normas regulamentadoras: o trabalho da casa é sempre em altura, na
-- rede, de EPI. Nenhuma das três é escolha de serviço.
UPDATE "itens_apr" SET "marcado_por_padrao" = true WHERE "categoria" = 'NORMA';

-- Os riscos do poste, que hoje são marcados à mão em todo serviço. Casados pelo
-- texto exato da semente — "Descarga elétrica" é o contato com a rede, e não
-- "Descargas atmosféricas", que é o raio e depende do tempo.
UPDATE "itens_apr"
SET "marcado_por_padrao" = true
WHERE "categoria" = 'RISCO'
  AND "texto" IN (
    'Queimaduras',
    'Choque elétrico',
    'Quedas de altura',
    'Quedas',
    'Descarga elétrica'
  );
