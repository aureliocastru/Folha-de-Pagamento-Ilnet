import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';

/**
 * Teto do corpo em JSON. O padrão do express é 100 KB, e a assinatura do
 * recibo da diária é uma imagem em base64 que passa disso — sem este ajuste
 * ela morre com 413 no caminho, depois de a pessoa já ter assinado.
 *
 * O número tem de ser o mesmo do `client_max_body_size` do nginx. Eles já
 * estiveram diferentes (1 MB aqui, 5 MB lá), e nessa faixa a guia em PDF
 * passava pelo nginx para morrer aqui.
 *
 * Subiu de 8 para 24 MB com a pasta do RH: o documento chega em base64, que
 * engorda um terço no caminho, e o teto por arquivo lá é de 15 MB. Um contrato
 * digitalizado colorido passa dos 8 com facilidade.
 */
const LIMITE_CORPO = '24mb';

/**
 * Promessa que falha sem ninguém para segurar não derruba a API.
 *
 * No Node 22 ela encerra o processo, e várias coisas daqui rodam em segundo
 * plano depois de a tela já ter recebido a resposta — a transferência do
 * almoxarifado, o acerto de negativos, o pacote da contabilidade, os vigias
 * do IXC. Cada uma trata o próprio erro, mas a que escapasse levaria junto
 * todo mundo que está usando o sistema, e o andamento das transferências que
 * estão rodando (que mora na memória). Fica no log, com a pilha, para ser
 * consertado na origem.
 */
process.on('unhandledRejection', (motivo) => {
  Logger.error(
    `Promessa rejeitada sem tratamento: ${
      motivo instanceof Error ? (motivo.stack ?? motivo.message) : String(motivo)
    }`,
    'Processo',
  );
});

async function bootstrap() {
  // O parser vem desligado para entrar de novo logo abaixo com o teto maior:
  // se o padrão for registrado antes, é ele quem recusa o corpo grande.
  const app = await NestFactory.create(AppModule, {
    cors: false,
    bodyParser: false,
  });
  app.use(json({ limit: LIMITE_CORPO }));
  app.use(urlencoded({ extended: true, limit: LIMITE_CORPO }));

  const config = app.get(ConfigService);

  const port = config.getOrThrow<AppConfig['port']>('port');
  const corsOrigins = config.getOrThrow<AppConfig['corsOrigins']>('corsOrigins');

  app.setGlobalPrefix('api');
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  await app.listen(port, '0.0.0.0');
  Logger.log(`API ouvindo em http://0.0.0.0:${port}/api`, 'Bootstrap');
}

bootstrap();
