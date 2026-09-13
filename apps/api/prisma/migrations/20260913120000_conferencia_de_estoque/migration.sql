-- Almoxarifado: a conferência de estoque — o inventário feito na prateleira.
--
-- O saldo continua sendo do IXC, e nada aqui guarda saldo. O que se guarda é o
-- caderno da contagem: o que já foi conferido em cada almoxarifado, por quem,
-- quanto o IXC dizia e quanto havia, e as transferências e compras que isso
-- lançou lá — com o número de cada uma, que é por onde se desfaz.

CREATE TYPE "SituacaoConferencia" AS ENUM ('EM_ANDAMENTO', 'BATEU', 'AJUSTADO', 'INCOMPLETO', 'DESFEITO');

CREATE TABLE "inventario_rodadas" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "iniciado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "iniciado_por" TEXT NOT NULL,
    "encerrado_em" TIMESTAMP(3),
    "encerrado_por" TEXT,

    CONSTRAINT "inventario_rodadas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conferencias_de_estoque" (
    "id" TEXT NOT NULL,
    "rodada_id" TEXT NOT NULL,
    "almox_id" INTEGER NOT NULL,
    "almoxarifado" TEXT NOT NULL,
    "produto_id" INTEGER NOT NULL,
    "descricao" TEXT NOT NULL,
    "unidade" TEXT,
    "patrimonio" BOOLEAN NOT NULL DEFAULT false,
    "sistema" DECIMAL(18,5) NOT NULL,
    "contado" DECIMAL(18,5) NOT NULL,
    "valor_unitario" DECIMAL(14,2),
    "situacao" "SituacaoConferencia" NOT NULL DEFAULT 'EM_ANDAMENTO',
    "saldo_depois" DECIMAL(18,5),
    "lancamentos" JSONB NOT NULL DEFAULT '[]',
    "pecas" JSONB,
    "pendencias" JSONB NOT NULL DEFAULT '[]',
    "observacao" TEXT,
    "erro" TEXT,
    "conferido_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terminado_em" TIMESTAMP(3),
    "desfeito_em" TIMESTAMP(3),
    "desfeito_por" TEXT,

    CONSTRAINT "conferencias_de_estoque_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inventario_rodadas_encerrado_em_idx" ON "inventario_rodadas"("encerrado_em");

-- Uma rodada aberta por vez. Sem isto, dois cliques em "começar" abririam duas,
-- e a contagem de um almoxarifado ficaria partida entre elas.
CREATE UNIQUE INDEX "inventario_rodadas_uma_aberta" ON "inventario_rodadas"(("encerrado_em" IS NULL)) WHERE "encerrado_em" IS NULL;

CREATE INDEX "conferencias_de_estoque_rodada_id_almox_id_idx" ON "conferencias_de_estoque"("rodada_id", "almox_id");
CREATE INDEX "conferencias_de_estoque_produto_id_almox_id_idx" ON "conferencias_de_estoque"("produto_id", "almox_id");

ALTER TABLE "conferencias_de_estoque"
  ADD CONSTRAINT "conferencias_de_estoque_rodada_id_fkey"
  FOREIGN KEY ("rodada_id") REFERENCES "inventario_rodadas"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
