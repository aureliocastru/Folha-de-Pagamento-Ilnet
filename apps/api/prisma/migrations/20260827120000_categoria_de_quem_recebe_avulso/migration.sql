-- A categoria de quem recebe fora da folha.
--
-- O pagamento avulso ja tinha o campo de categoria na tela, e ele nascia vazio
-- toda vez. Quem paga o mesmo pedreiro pela quarta vez escolhe "Obras" pela
-- quarta vez -- e e na quarta que alguem deixa em "Sem classificacao": a conta
-- vai para o IXC sem etiqueta e some do dashboard do Contas a Pagar, que e
-- justamente onde ela seria procurada.
--
-- Guardando a escolha no cadastro de quem recebe, o pagamento seguinte ja abre
-- marcado. Mudar a categoria na hora de pagar regrava o padrao: quem trocou de
-- ramo troca uma vez so.

ALTER TABLE "beneficiarios_avulsos" ADD COLUMN "categoria_id" TEXT;

ALTER TABLE "beneficiarios_avulsos"
  ADD CONSTRAINT "beneficiarios_avulsos_categoria_id_fkey"
  FOREIGN KEY ("categoria_id") REFERENCES "categorias_despesa"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- O padrao de quem ja recebeu sai do que ja foi etiquetado.
--
-- Sem isto, "ja vem marcado" so valeria do proximo pagamento em diante, e a
-- primeira vez de cada pessoa continuaria sendo a que escapa. A etiqueta do
-- titulo mais recente daquela pessoa e a melhor aposta que existe aqui: e a
-- ultima decisao que alguem tomou sobre ela.
--
-- E aposta, e nao lei: e so o que a tela mostra escolhido, e quem discordar
-- troca no ato de pagar.
UPDATE "beneficiarios_avulsos" b
SET "categoria_id" = (
  SELECT cc."categoria_id"
    FROM "contas_pagar" c
    JOIN "classificacoes_conta" cc ON cc."id_fn_apagar" = c."id_fn_apagar_ixc"
   WHERE c."beneficiario_avulso_id" = b."id"
   ORDER BY c."created_at" DESC
   LIMIT 1
)
WHERE b."categoria_id" IS NULL;
