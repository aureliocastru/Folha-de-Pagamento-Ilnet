-- Pontuacao dos funcionarios.
--
-- Os coordenadores dao pontos -- a mais ou a menos, sempre com o motivo -- e
-- cada funcionario ve os seus digitando o proprio CPF. E um mundo a parte dos
-- logins do sistema: coordenador nao e usuario, e quem pontua nao precisa
-- enxergar folha, contas ou RH.

-- Quem pode pontuar. Entra com o CPF e uma senha curta de numeros; na quinta
-- senha errada seguida o login trava por um tempo.
CREATE TABLE "coordenadores_pontuacao" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "bloqueado_ate" TIMESTAMP(3),
    "ultimo_acesso_em" TIMESTAMP(3),
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coordenadores_pontuacao_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "coordenadores_pontuacao_cpf_key" ON "coordenadores_pontuacao"("cpf");

-- Os pontos: quantos, por que, de que dia, e quem deu. O nome de quem lancou
-- fica escrito na linha, e sobrevive ao coordenador ser apagado.
CREATE TABLE "lancamentos_de_pontos" (
    "id" TEXT NOT NULL,
    "funcionario_id" TEXT NOT NULL,
    "pontos" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "competencia" TEXT NOT NULL,
    "coordenador_id" TEXT,
    "usuario_id" TEXT,
    "lancado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lancamentos_de_pontos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lancamentos_de_pontos_competencia_idx" ON "lancamentos_de_pontos"("competencia");
CREATE INDEX "lancamentos_de_pontos_funcionario_id_competencia_idx" ON "lancamentos_de_pontos"("funcionario_id", "competencia");

ALTER TABLE "lancamentos_de_pontos"
  ADD CONSTRAINT "lancamentos_de_pontos_funcionario_id_fkey"
  FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lancamentos_de_pontos"
  ADD CONSTRAINT "lancamentos_de_pontos_coordenador_id_fkey"
  FOREIGN KEY ("coordenador_id") REFERENCES "coordenadores_pontuacao"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
