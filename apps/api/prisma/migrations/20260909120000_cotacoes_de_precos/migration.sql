-- Cotações de preços: o que a casa compra, e por quanto, em cada fornecedor.
--
-- Três tabelas e nenhum vínculo com o IXC. O fornecedor daqui não é o do IXC —
-- lá estão os três mil e duzentos que já receberam dinheiro da empresa, e aqui
-- é a lista curta de quem tem preço de material para dar. Cadastro próprio, um
-- por um.
--
-- O preço é um registro por cotação, e não um campo que se sobrescreve: o que
-- vale hoje é o mais recente de cada fornecedor, e o que ficou para trás é a
-- história que responde "isto subiu quanto desde março?".

CREATE TYPE "UnidadeProduto" AS ENUM ('UN', 'M', 'KM', 'CX', 'ROLO', 'PCT', 'KG', 'L', 'PAR');

CREATE TABLE "fornecedores_cotacao" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nome_fantasia" TEXT,
    "cnpj" TEXT,
    "contato" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "site" TEXT,
    "observacao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fornecedores_cotacao_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "produtos_cotados" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "codigo" TEXT,
    "unidade" "UnidadeProduto" NOT NULL DEFAULT 'UN',
    "observacao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "produtos_cotados_pkey" PRIMARY KEY ("id")
);

-- `valor` com quatro casas de propósito: drop sai a R$ 0,4750 o metro, e
-- arredondar para R$ 0,48 erra R$ 25,00 num rolo de dez mil metros — bem acima
-- do que costuma separar dois fornecedores.
CREATE TABLE "precos_de_produto" (
    "id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "fornecedor_id" TEXT NOT NULL,
    "valor" DECIMAL(14,4) NOT NULL,
    "data" DATE NOT NULL,
    "quantidade_minima" DECIMAL(14,3),
    "observacao" TEXT,
    "registrado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "precos_de_produto_pkey" PRIMARY KEY ("id")
);

-- Nome único nos dois cadastros: o mesmo fornecedor em duas linhas espalharia
-- os preços dele em duas listas, e "onde está mais barato?" passaria a ter duas
-- respostas certas e nenhuma completa.
CREATE UNIQUE INDEX "fornecedores_cotacao_nome_key" ON "fornecedores_cotacao"("nome");
CREATE UNIQUE INDEX "produtos_cotados_nome_key" ON "produtos_cotados"("nome");

-- A consulta que a tela inteira faz: os preços de um produto, por fornecedor,
-- do mais recente para o mais antigo.
CREATE INDEX "precos_de_produto_produto_id_fornecedor_id_data_idx" ON "precos_de_produto"("produto_id", "fornecedor_id", "data");
CREATE INDEX "precos_de_produto_fornecedor_id_idx" ON "precos_de_produto"("fornecedor_id");

-- `RESTRICT` nos dois: produto ou fornecedor com preço cadastrado não some por
-- um clique. Quem quiser mesmo apagar apaga os preços antes, e a tela diz
-- quantos são. O caminho de todo dia é desativar.
ALTER TABLE "precos_de_produto"
  ADD CONSTRAINT "precos_de_produto_produto_id_fkey"
  FOREIGN KEY ("produto_id") REFERENCES "produtos_cotados"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "precos_de_produto"
  ADD CONSTRAINT "precos_de_produto_fornecedor_id_fkey"
  FOREIGN KEY ("fornecedor_id") REFERENCES "fornecedores_cotacao"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
