import { createCipheriv, createDecipheriv, randomBytes, randomInt, scryptSync } from 'node:crypto';

/**
 * A senha guardada para o administrador poder vê-la.
 *
 * Quem entra continua sendo conferido pelo hash (bcrypt), que não se desfaz; a
 * cópia daqui é cifrada com AES-256-GCM e só existe para ser mostrada. A chave
 * sai do segredo do sistema (`SENHAS_CHAVE`, ou o do JWT na falta dela) e nunca
 * vai ao banco: quem tiver só o banco não lê senha nenhuma.
 *
 * Trocar o segredo torna as cópias ilegíveis — aí a tela diz que é preciso
 * gerar uma senha nova, em vez de mostrar lixo.
 */
const VERSAO = 'v1';

function chave(segredo: string): Buffer {
  return scryptSync(segredo, 'ilnet-senhas-v1', 32);
}

export function cifrarSenha(senha: string, segredo: string): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chave(segredo), iv);
  const dados = Buffer.concat([cifra.update(senha, 'utf8'), cifra.final()]);
  const tag = cifra.getAuthTag();
  return [VERSAO, iv.toString('base64'), tag.toString('base64'), dados.toString('base64')].join(':');
}

/** Null quando não dá para ler: formato estranho, ou segredo trocado. */
export function decifrarSenha(guardada: string, segredo: string): string | null {
  const [versao, iv, tag, dados] = guardada.split(':');
  if (versao !== VERSAO || !iv || !tag || !dados) return null;
  try {
    const decifra = createDecipheriv('aes-256-gcm', chave(segredo), Buffer.from(iv, 'base64'));
    decifra.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decifra.update(Buffer.from(dados, 'base64')), decifra.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Uma senha para passar de boca ou por mensagem: dez letras e números, sem os
 * que se confundem (0/O, 1/l/I).
 */
export function gerarSenha(tamanho = 10): string {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: tamanho }, () => letras[randomInt(letras.length)]).join('');
}
