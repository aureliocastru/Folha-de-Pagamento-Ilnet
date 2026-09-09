-- Almoxarifado: as ferramentas da casa e o caderno de quem as levou.
--
-- Ferramenta não é material, e é por isso que ela não é mais uma linha de
-- estoque. Cem metros de drop saem e acabaram — a pergunta é "quanto sobrou".
-- A máquina de fusão sai e tem de voltar, e a pergunta é "quem está com ela?".
-- Saldo não responde isso; um caderno de saída e volta responde.
--
-- O estoque de material continua sendo o do IXC, e esta casa só o lê. O caderno
-- de ferramenta é daqui porque o IXC não tem onde guardá-lo: o que existe lá é
-- comodato de cliente e produto de ordem de serviço, e nenhum dos dois é a
-- chave de fenda que o técnico levou na sexta.

CREATE TABLE "ferramentas" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "patrimonio" TEXT,
    "descricao" TEXT,
    "ixc_produto_id" INTEGER,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ferramentas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "emprestimos_de_ferramenta" (
    "id" TEXT NOT NULL,
    "ferramenta_id" TEXT NOT NULL,
    "funcionario_id" TEXT,
    "quem" TEXT NOT NULL,
    "saiu_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previsao_de_volta" DATE,
    "voltou_em" TIMESTAMP(3),
    "observacao" TEXT,
    "registrado_por" TEXT,
    "recebido_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emprestimos_de_ferramenta_pkey" PRIMARY KEY ("id")
);

-- O patrimônio é o que distingue duas máquinas de fusão iguais. Sem ele elas
-- são a mesma linha, e "quem está com a máquina de fusão" volta a não ter
-- resposta na casa que tem duas.
CREATE UNIQUE INDEX "ferramentas_patrimonio_key" ON "ferramentas"("patrimonio");
CREATE INDEX "ferramentas_ativa_idx" ON "ferramentas"("ativa");

CREATE INDEX "emprestimos_de_ferramenta_ferramenta_id_voltou_em_idx" ON "emprestimos_de_ferramenta"("ferramenta_id", "voltou_em");
CREATE INDEX "emprestimos_de_ferramenta_funcionario_id_idx" ON "emprestimos_de_ferramenta"("funcionario_id");

ALTER TABLE "emprestimos_de_ferramenta"
  ADD CONSTRAINT "emprestimos_de_ferramenta_ferramenta_id_fkey"
  FOREIGN KEY ("ferramenta_id") REFERENCES "ferramentas"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- `SET NULL`: apagado o cadastro do funcionário, o empréstimo continua — o
-- nome de quem levou está escrito na própria linha, e é ele que responde.
ALTER TABLE "emprestimos_de_ferramenta"
  ADD CONSTRAINT "emprestimos_de_ferramenta_funcionario_id_fkey"
  FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Uma ferramenta, um empréstimo aberto.
--
-- Índice parcial, que o Prisma não sabe declarar — por isso ele mora aqui e há
-- um comentário no schema apontando para cá. Sem ele, dois cliques em
-- "Emprestar" poriam a mesma máquina de fusão na mão de duas pessoas, e a tela
-- passaria a mostrar a última: a primeira sumiria sem ninguém notar, e é
-- justamente ela que estaria com a ferramenta.
CREATE UNIQUE INDEX "emprestimo_aberto_unico"
  ON "emprestimos_de_ferramenta"("ferramenta_id")
  WHERE "voltou_em" IS NULL;

-- O módulo "Cotações de Preços" virou uma aba do Almoxarifado.
--
-- A lista de módulos de um login é de restrição, e quem tivesse "cotacoes"
-- escrito nela perderia o acesso ao renomearmos o módulo — sem erro, sem
-- aviso: o cartão simplesmente sumiria da tela dele. A troca acompanha o nome.
UPDATE "users"
SET "modulos" = array_replace("modulos", 'cotacoes', 'almoxarifado')
WHERE 'cotacoes' = ANY("modulos");
