/** Só os dígitos: o CPF chega com ponto e traço, e o IXC o guarda assim. */
export function somenteDigitos(texto: string | null | undefined): string {
  return String(texto ?? '').replace(/\D/g, '');
}

/**
 * O CPF fecha nos dois dígitos verificadores?
 *
 * É o que pega o número digitado com um dígito trocado antes de ele virar o
 * login de um coordenador que nunca conseguiria entrar. Os onze iguais
 * ("111.111.111-11") fecham na conta e não são CPF de ninguém.
 */
export function cpfValido(texto: string): boolean {
  const cpf = somenteDigitos(texto);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const digito = (ate: number) => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(cpf[i]) * (ate + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}
