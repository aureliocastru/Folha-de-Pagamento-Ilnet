-- Perfis de acesso montados pelo administrador, e a senha que ele pode ver.
--
-- O perfil diz, modulo por modulo, se o login nao abre, so ve ou mexe. Os
-- perfis fixos de antes (ADMIN, RH, VISUALIZADOR, TECNICO) continuam valendo
-- para quem nao tem perfil criado.

CREATE TABLE "perfis_de_acesso" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "permissoes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perfis_de_acesso_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "perfis_de_acesso_nome_key" ON "perfis_de_acesso"("nome");

ALTER TABLE "users" ADD COLUMN "perfil_id" TEXT;

ALTER TABLE "users"
  ADD CONSTRAINT "users_perfil_id_fkey"
  FOREIGN KEY ("perfil_id") REFERENCES "perfis_de_acesso"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- A senha cifrada, so para o administrador ver. Quem entra continua sendo
-- conferido pelo hash; os logins de antes ficam sem ela ate a senha ser trocada.
ALTER TABLE "users" ADD COLUMN "senha_cifrada" TEXT;
