-- Veiculo no nome de um login, e nao so de um funcionario.
--
-- O dono e o administrador andam com a Hilux e a abastecem, mas nao estao na
-- folha -- nao sao fornecedor isento no IXC --, e por isso nao apareciam para
-- ficar com veiculo nenhum. Agora o veiculo pode ficar no nome do login deles,
-- e o cartao Abastecimento da tela de modulos passa a aparecer para eles.

CREATE TABLE "veiculo_logins" (
    "veiculo_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "veiculo_logins_pkey" PRIMARY KEY ("veiculo_id", "usuario_id")
);

CREATE INDEX "veiculo_logins_usuario_id_idx" ON "veiculo_logins"("usuario_id");

ALTER TABLE "veiculo_logins"
  ADD CONSTRAINT "veiculo_logins_veiculo_id_fkey"
  FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "veiculo_logins"
  ADD CONSTRAINT "veiculo_logins_usuario_id_fkey"
  FOREIGN KEY ("usuario_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
