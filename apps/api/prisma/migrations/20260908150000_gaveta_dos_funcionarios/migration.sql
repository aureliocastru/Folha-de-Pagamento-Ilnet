-- A gaveta "Funcionários", e todo mundo dentro dela.
--
-- A estante abria com quarenta e poucas pastas de gente no primeiro nível, em
-- ordem alfabética, e as três que não são de gente — Empresa, Licitações, Notas
-- Fiscais — ficavam perdidas no meio delas. Quem entrava no RH para pegar um
-- alvará rolava a tela procurando pela letra "E".
--
-- Depois desta migração o primeiro nível é curto: a pasta da empresa, esta
-- gaveta, e as pastas de assunto. A gente está um clique adentro.
ALTER TABLE "pastas_rh"
  ADD COLUMN "dos_funcionarios" BOOLEAN NOT NULL DEFAULT false;

-- Uma só, e marcada — não achada pelo nome. Renomeá-la é coisa que o
-- administrador pode querer fazer, e no dia em que ela virasse "Colaboradores"
-- o sistema abriria uma segunda gaveta vazia ao lado da primeira.
INSERT INTO "pastas_rh" ("id", "nome", "dos_funcionarios", "created_at", "updated_at")
SELECT gen_random_uuid(), 'Funcionários', true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "pastas_rh" WHERE "dos_funcionarios");

-- O que entra na gaveta: a pasta de quem está no cadastro, e a pasta avulsa que
-- tem CPF.
--
-- O CPF é o que separa "pasta de uma pessoa" de "pasta de um assunto": a do
-- sócio e a do estagiário foram criadas à mão, não têm funcionário atrás, e
-- pertencem à gaveta tanto quanto as outras. "Licitações" e "Notas Fiscais" não
-- têm CPF e ficam onde estão — assim como qualquer pasta de assunto que alguém
-- tenha criado na estante.
UPDATE "pastas_rh"
SET "pai_id" = (SELECT "id" FROM "pastas_rh" WHERE "dos_funcionarios" LIMIT 1)
WHERE "pai_id" IS NULL
  AND "da_empresa" = false
  AND "dos_funcionarios" = false
  AND ("funcionario_id" IS NOT NULL OR "cpf" IS NOT NULL);
