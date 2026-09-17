-- A media que se espera de cada veiculo.
--
-- Nao e calculo: e o que a casa sabe do carro -- a Hilux faz 8 km/L, a moto faz
-- 40, a retroescavadeira come 12 litros por hora. Guardada aqui, a tela pode
-- comparar com a media de verdade e acender o amarelo quando ela cai: pneu
-- murcho, filtro sujo, bico entupido -- ou combustivel saindo por onde nao devia.
ALTER TABLE "veiculos" ADD COLUMN "consumo_ideal" DECIMAL(6,2);
