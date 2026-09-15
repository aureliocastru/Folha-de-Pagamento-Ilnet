-- O colaborador que cada login e, para a tela do colaborador mostrar a
-- pontuacao dele e o veiculo que esta no nome dele.
--
-- Vazia em todos os logins de hoje: enquanto o administrador nao liga, o
-- sistema acha a pessoa pelo nome. Unica: uma pessoa, um login.

ALTER TABLE "users" ADD COLUMN "funcionario_id" TEXT;

CREATE UNIQUE INDEX "users_funcionario_id_key" ON "users"("funcionario_id");

ALTER TABLE "users"
  ADD CONSTRAINT "users_funcionario_id_fkey"
  FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
