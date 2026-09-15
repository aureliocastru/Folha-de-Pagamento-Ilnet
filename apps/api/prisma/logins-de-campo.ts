import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  planejarLogins,
  type PlanoDeLogin,
} from '../src/usuarios/login-de-campo';

/**
 * Abre o login de campo de quem ainda não tem.
 *
 * A equipe inteira precisa entrar no app para preencher a APR antes de subir no
 * poste, e abrir trinta logins na tela, um a um, é meia hora de digitação com
 * um erro de e-mail no meio — o erro que só aparece no dia em que a pessoa está
 * na rua e não consegue entrar.
 *
 * Quem manda na lista é o cadastro, e não uma lista digitada aqui: entra quem
 * está **ativo** no IXC (quem saiu não ganha acesso novo) e não tem login. O
 * endereço sai de `src/usuarios/login-de-campo.ts`, que é onde a regra mora e
 * onde ela é testada.
 *
 * Rodar dá para rodar quantas vezes quiser: quem já tem login é pulado, e o
 * segundo passe não mexe na senha de ninguém.
 *
 *     npm run logins:campo -- --previa   # mostra o que faria, sem escrever
 *     npm run logins:campo               # abre os logins
 *
 * `PULAR="fulano@ilnet.com.br"` deixa alguém de fora, e `SENHA_PADRAO` troca a
 * senha inicial.
 *
 * A senha inicial é a mesma para todos, e é para ser trocada — cada um troca a
 * sua em "Minha conta", que é a única tela que um TECNICO abre além da APR.
 */

/** Todos nascem técnicos de campo: o perfil abre a APR e mais nada. */
const PERFIL = UserRole.TECNICO;

const SENHA_INICIAL = process.env.SENHA_PADRAO ?? '12345678';
const CUSTO_HASH = 10;

/**
 * Endereços a deixar de fora desta rodada: `PULAR="a@ilnet.com.br,b@..."`.
 *
 * Existe para o caso que o cadastro não resolve: a pessoa que já entra no app
 * por um login com outro nome (um "Administrador" qualquer), e que ganharia
 * aqui um segundo login sem ninguém ter pedido. A prévia mostra quem é; isto
 * tira da lista.
 */
const PULAR = new Set(
  (process.env.PULAR ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

const prisma = new PrismaClient();

async function main() {
  const previa = process.argv.includes('--previa');

  if (SENHA_INICIAL.length < 8) {
    throw new Error(
      `A senha inicial tem ${SENHA_INICIAL.length} caracteres. O app exige 8 ` +
        '— com menos, ninguém consegue nem trocá-la depois.',
    );
  }

  const [funcionarios, existentes] = await Promise.all([
    prisma.funcionario.findMany({
      where: { isentoIcms: true },
      select: { id: true, nome: true, ativo: true },
      orderBy: { nome: 'asc' },
    }),
    prisma.user.findMany({ select: { nome: true, email: true, funcionarioId: true } }),
  ]);

  const ativos = funcionarios.filter((f) => f.ativo);
  const sairam = funcionarios.filter((f) => !f.ativo);

  const plano = planejarLogins(ativos, existentes);
  const abrir = plano.filter((p) => p.criar && !PULAR.has(p.email));
  const pulados = plano.filter((p) => p.criar && PULAR.has(p.email));
  const jaTem = plano.filter((p) => !p.criar);

  console.log(`\nLogins de campo — perfil ${PERFIL}`);
  console.log(`Senha inicial: ${SENHA_INICIAL} (cada um troca em Minha conta)`);

  listar(`A abrir (${abrir.length})`, abrir);
  listar(`Já tinham (${jaTem.length})`, jaTem);
  listar(`Fora, a seu pedido (${pulados.length})`, pulados);

  if (sairam.length > 0) {
    console.log(`\nFora — saíram da empresa (${sairam.length}):`);
    for (const f of sairam) console.log(`  ${f.nome}`);
  }

  if (previa) {
    console.log('\nPrévia: nada foi escrito. Rode sem --previa para abrir.\n');
    return;
  }
  if (abrir.length === 0) {
    console.log('\nNenhum login a abrir — todo mundo já tem o seu.\n');
    return;
  }

  console.log('');
  let abertos = 0;
  for (const pessoa of abrir) {
    try {
      await prisma.user.create({
        data: {
          nome: pessoa.nome,
          email: pessoa.email,
          senhaHash: await bcrypt.hash(SENHA_INICIAL, CUSTO_HASH),
          role: PERFIL,
          // Já nasce ligado à pessoa: é o que a tela do colaborador usa para
          // mostrar a pontuação e o veículo dela, sem depender do nome.
          funcionarioId: pessoa.id,
          // Vazio de propósito: o TECNICO não tem lista de módulos, tem a
          // Segurança do Trabalho — ver `MODULO_DO_TECNICO` no `ModulosGuard`.
          modulos: [],
        },
      });
      abertos += 1;
      console.log(`  ok   ${pessoa.email}`);
    } catch (erro) {
      // Um e-mail que o banco recusa não pode custar os outros vinte e quatro.
      console.error(`  erro ${pessoa.email}: ${String(erro)}`);
    }
  }

  console.log(`\n${abertos} login(s) abertos de ${abrir.length}.\n`);
}

function listar(titulo: string, linhas: PlanoDeLogin[]): void {
  if (linhas.length === 0) return;
  console.log(`\n${titulo}:`);
  for (const linha of linhas) {
    const endereco = (linha.email || '—').padEnd(32);
    const motivo = linha.motivo ? `   (${linha.motivo})` : '';
    console.log(`  ${endereco}${linha.nome}${motivo}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
