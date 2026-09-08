-- O bloco de notas que abre no canto da tela, e que é de cada um.
--
-- A chave primária é o id do usuário, e não um id próprio: é o que garante uma
-- linha por login. Gravar vira um `upsert` por essa chave, e duas abas abertas
-- na mesma conta passam a escrever no mesmo papel em vez de criarem dois
-- textos que se ignoram.
--
-- Um campo de texto só, sem estrutura. A tentação de dividir em "compromisso",
-- "data" e "feito" é a de transformar um papel em formulário: quem escreve um
-- lembrete de meia linha não preenche três campos para guardá-lo, e o bloco
-- deixaria de ser usado.
CREATE TABLE "agendas" (
    "usuario_id" TEXT NOT NULL,
    "texto" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agendas_pkey" PRIMARY KEY ("usuario_id")
);

-- `CASCADE` porque o bloco é recado particular de uma pessoa, e não registro
-- da empresa: fechada a conta, não há a quem ele sobre.
ALTER TABLE "agendas"
  ADD CONSTRAINT "agendas_usuario_id_fkey"
  FOREIGN KEY ("usuario_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
