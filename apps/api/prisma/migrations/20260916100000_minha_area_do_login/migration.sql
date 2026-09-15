-- O que e da propria pessoa e o login abre: a pontuacao dela, o abastecimento
-- do veiculo dela, e pontuar (coordenador). Marcado junto dos modulos.
--
-- Os logins de hoje ficam com o que ja viam (pontuacao e abastecimento);
-- pontuar, ninguem ate o administrador marcar.

ALTER TABLE "users" ADD COLUMN "minha_area" TEXT[] DEFAULT ARRAY['pontuacao', 'abastecimento']::TEXT[];
