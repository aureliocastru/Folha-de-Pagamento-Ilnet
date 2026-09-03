/**
 * De que endereço é o login de cada pessoa da casa.
 *
 * A regra é o primeiro nome mais o domínio: `werick@ilnet.com.br`. Ela é boa
 * porque é a que a pessoa consegue repetir de cabeça na beira da estrada — e é
 * incompleta, porque numa empresa pequena os primeiros nomes se repetem. São
 * três Marcos e dois Luans no cadastro; dar a todos `marco@` daria a um só, e
 * os outros dois ficariam sem entrar sem ninguém entender por quê.
 *
 * Então o primeiro nome vale enquanto for de uma pessoa só. Havendo dois, cada
 * um leva o segundo nome junto (`marco.aurelio@`), que é como as pessoas já se
 * distinguem quando falam umas das outras.
 *
 * O que vive aqui é só a decisão — quem ganha login e com que endereço. Quem
 * escreve no banco é `prisma/logins-de-campo.ts`, e é de propósito: a parte que
 * erra é esta, e ela se prova sem banco nenhum.
 */

export const DOMINIO_DA_CASA = 'ilnet.com.br';

/**
 * As partículas do nome, que não viram endereço.
 *
 * "Marco Thalles da Costa e Castro" tem seis palavras e três pessoas dentro:
 * um endereço com `da` e `e` no meio não é um endereço, é uma senha.
 */
const PARTICULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'du', 'e']);

/** Sem acento, sem cedilha, minúsculo: é o que pode virar endereço. */
export function simples(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Os pedaços do nome que servem de endereço, na ordem em que se fala. */
export function pedacosDoNome(nome: string): string[] {
  return nome
    .split(/\s+/)
    .map(simples)
    .filter((p) => p.length > 1 && !PARTICULAS.has(p));
}

export interface PessoaParaLogin {
  id: string;
  nome: string;
}

export interface LoginExistente {
  nome: string;
  email: string;
}

export interface PlanoDeLogin {
  id: string;
  nome: string;
  /** O endereço: o que vai ser criado, ou o que já existe. */
  email: string;
  criar: boolean;
  /** Por que não vai ser criado. Vazio quando vai. */
  motivo?: string;
}

/**
 * Quem ganha login, e com que endereço.
 *
 * Devolve a lista inteira — inclusive quem já tem —, porque quem roda isto
 * precisa conferir a decisão antes de ela virar acesso ao sistema: um endereço
 * errado é uma pessoa que não entra, e um login a mais é uma pessoa que entra
 * sem ninguém ter querido.
 */
export function planejarLogins(
  pessoas: PessoaParaLogin[],
  existentes: LoginExistente[],
  dominio: string = DOMINIO_DA_CASA,
): PlanoDeLogin[] {
  const ocupados = new Set(
    existentes.map((l) => l.email.trim().toLowerCase()),
  );
  const logins = existentes.map((l) => ({
    email: l.email.trim().toLowerCase(),
    pedacos: pedacosDoNome(l.nome),
  }));

  // Quantos dividem o primeiro nome: é o que decide se ele basta sozinho.
  const quantos = new Map<string, number>();
  for (const pessoa of pessoas) {
    const primeiro = pedacosDoNome(pessoa.nome)[0];
    if (primeiro) quantos.set(primeiro, (quantos.get(primeiro) ?? 0) + 1);
  }

  const reservados = new Set<string>();
  const plano: PlanoDeLogin[] = [];

  for (const pessoa of pessoas) {
    const pedacos = pedacosDoNome(pessoa.nome);
    const primeiro = pedacos[0];
    if (!primeiro) {
      plano.push({
        ...pessoa,
        email: '',
        criar: false,
        motivo: 'o nome não vira endereço',
      });
      continue;
    }

    /*
     * Já tem login, pelo nome.
     *
     * "Marco Antonio" é o começo de "Marco Antonio Castro": é a mesma pessoa,
     * cadastrada com o nome curto. Sem esta conferência, ela ganharia um
     * segundo login — e um segundo login é uma segunda senha, que ninguém sabe
     * qual das duas é a que vale.
     */
    const peloNome = logins.find((l) => comecaCom(pedacos, l.pedacos));
    if (peloNome) {
      plano.push({
        ...pessoa,
        email: peloNome.email,
        criar: false,
        motivo: 'já tem login',
      });
      continue;
    }

    /*
     * Já tem login, pelo endereço.
     *
     * Sendo o único com aquele primeiro nome, `werick@` é dele — mesmo que o
     * login esteja gravado com outro nome ("Werick Coast" e "Werick da Cruz
     * Costa" são a mesma pessoa escrita de dois jeitos).
     */
    const simplesEmail = `${primeiro}@${dominio}`;
    if ((quantos.get(primeiro) ?? 1) === 1 && ocupados.has(simplesEmail)) {
      plano.push({
        ...pessoa,
        email: simplesEmail,
        criar: false,
        motivo: 'já existe login com este endereço',
      });
      continue;
    }

    const email = enderecoLivre(pedacos, quantos, dominio, ocupados, reservados);
    reservados.add(email);
    plano.push({ ...pessoa, email, criar: true });
  }

  return plano;
}

/** O nome do login é o começo do nome do cadastro (ou o contrário). */
function comecaCom(nome: string[], outro: string[]): boolean {
  if (outro.length === 0 || nome.length === 0) return false;
  const menor = outro.length <= nome.length ? outro : nome;
  const maior = outro.length <= nome.length ? nome : outro;
  return menor.every((pedaco, i) => pedaco === maior[i]);
}

/**
 * O endereço que ninguém está usando.
 *
 * Começa no primeiro nome — ou no primeiro mais o segundo, quando o primeiro é
 * de mais de um — e vai acrescentando nome enquanto estiver ocupado. Esgotados
 * os nomes, entra um número: é feio, e é melhor que deixar alguém sem login.
 */
function enderecoLivre(
  pedacos: string[],
  quantos: Map<string, number>,
  dominio: string,
  ocupados: Set<string>,
  reservados: Set<string>,
): string {
  const compartilhado = (quantos.get(pedacos[0]) ?? 1) > 1;
  let usados = compartilhado ? 2 : 1;

  const livre = (endereco: string) =>
    !ocupados.has(endereco) && !reservados.has(endereco);

  while (usados <= pedacos.length) {
    const endereco = `${pedacos.slice(0, usados).join('.')}@${dominio}`;
    if (livre(endereco)) return endereco;
    usados += 1;
  }

  const base = pedacos.join('.');
  for (let n = 2; ; n += 1) {
    const endereco = `${base}${n}@${dominio}`;
    if (livre(endereco)) return endereco;
  }
}

/**
 * Quem, do cadastro, já entra no app.
 *
 * É a pergunta do abridor de logins virada do avesso: lá interessa quem falta,
 * aqui interessa quem tem. Quem pergunta é a APR, e o motivo é o arquivo — ela
 * guarda uma cópia na pasta de cada executante, e a pasta de quem não entra no
 * sistema é gaveta que ninguém abre. Fora da lista, então, quem não tem login.
 *
 * Vale a mesma identidade por nome usada para não abrir login repetido:
 * "Marco Antonio" e "Marco Antonio Castro" são a mesma pessoa. Devolve os `id`
 * de quem tem, para quem chamou peneirar a própria lista.
 *
 * De propósito não olha se o login está ativo: quem decide isso é a mesma
 * conferência que `prisma/logins-de-campo.ts` faz, e as duas discordarem seria
 * o abridor dizendo "já tem login" para alguém que a APR não mostra.
 */
export function quemTemLogin(
  pessoas: PessoaParaLogin[],
  existentes: LoginExistente[],
  dominio: string = DOMINIO_DA_CASA,
): Set<string> {
  return new Set(
    planejarLogins(pessoas, existentes, dominio)
      // `criar` falso e endereço em branco é o nome que não vira endereço —
      // essa pessoa não tem login, ela não chega a ter endereço possível.
      .filter((p) => !p.criar && p.email !== '')
      .map((p) => p.id),
  );
}
