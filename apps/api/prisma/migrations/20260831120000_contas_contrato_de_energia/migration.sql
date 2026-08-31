-- Contas contrato: a conta de luz de cada endereco da empresa.
--
-- Sao onze unidades consumidoras -- loja, garagem, fazenda, as casas -- e cada
-- uma tem um numero de conta contrato na distribuidora. As faturas chegam
-- juntas, uma vez por mes, cada uma com um valor diferente, e ate agora cada
-- uma virava um lancamento a mao: procurar o fornecedor, escolher a conta
-- contabil, escrever de que endereco era. Onze vezes, todo mes, no mesmo dia --
-- e quando uma faltava ninguem tinha como saber qual, porque a lista das onze
-- so existia num papel.
--
-- O que esta tabela guarda e o que nao muda: o endereco, o numero da conta
-- contrato, para quem se paga e como a conta sai. O quanto -- que e o que muda
-- todo mes -- continua sendo digitado na hora, porque conta de luz nao se sabe
-- de antemao.
CREATE TABLE "contas_contrato" (
    "id" TEXT NOT NULL,

    -- O endereco como a casa o chama ("Lago Verde", "Garagem"), e o numero na
    -- distribuidora. O numero e unico: duas linhas com a mesma conta contrato
    -- seriam a mesma fatura lancada duas vezes.
    "apelido" TEXT NOT NULL,
    "numero"  TEXT NOT NULL,

    "id_fornecedor_ixc" INTEGER NOT NULL,
    "fornecedor_nome"   TEXT NOT NULL,

    -- Nao sao promessa da distribuidora: e o que se observou. O dia de chegada
    -- serve para a tela cobrar a fatura que nao chegou; o de vencimento, para
    -- a geracao ja sugerir a data.
    "dia_de_chegada"    INTEGER NOT NULL,
    "dia_de_vencimento" INTEGER NOT NULL,

    -- Quanto costuma vir. Vazio ate a primeira conta ser gerada; dai em diante
    -- e a media do que ja passou, e e com ela que a tela estranha o valor que
    -- fugiu do padrao.
    "valor_de_referencia" DECIMAL(14,2),

    "conta_contabil"     INTEGER,
    "conta_pagamento"    INTEGER,
    "tipo_pagamento_ixc" TEXT,
    "categoria_id"       TEXT,

    "observacao" TEXT,

    -- Desligada some da lista do mes (imovel vendido, ponto desativado). O que
    -- ela ja gerou continua de pe: sao contas de verdade no IXC.
    "ativa" BOOLEAN NOT NULL DEFAULT true,

    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_contrato_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contas_contrato_numero_key" ON "contas_contrato"("numero");
CREATE INDEX "contas_contrato_ativa_idx" ON "contas_contrato"("ativa");

ALTER TABLE "contas_contrato"
  ADD CONSTRAINT "contas_contrato_categoria_id_fkey"
  FOREIGN KEY ("categoria_id") REFERENCES "categorias_despesa"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- De que endereco e este titulo, e de que mes.
--
-- O par (conta contrato, competencia) e o que responde "a de agosto do Lago
-- Verde ja foi lancada?". Sem ele a unica resposta seria procurar na lista do
-- IXC por um texto parecido -- que e exatamente o que faz a conta ser lancada
-- duas vezes num mes em que a fatura chegou atrasada.
ALTER TABLE "contas_pagar" ADD COLUMN "conta_contrato_id" TEXT;

ALTER TABLE "contas_pagar"
  ADD CONSTRAINT "contas_pagar_conta_contrato_id_fkey"
  FOREIGN KEY ("conta_contrato_id") REFERENCES "contas_contrato"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "contas_pagar_conta_contrato_id_competencia_idx"
  ON "contas_pagar"("conta_contrato_id", "competencia");
