import { readOlistV3CallbackParams } from './olist-v3-callback-params';

describe('readOlistV3CallbackParams', () => {
  it('lê code e state e ignora parâmetros extras do provedor (session_state, iss)', () => {
    expect(
      readOlistV3CallbackParams({ code: 'c1', state: 's1', session_state: 'x', iss: 'https://accounts.tiny.com.br' }),
    ).toEqual({ code: 'c1', state: 's1' });
  });

  it('devolve null sem code ou sem state', () => {
    expect(readOlistV3CallbackParams({ state: 's1' })).toBeNull();
    expect(readOlistV3CallbackParams({ code: 'c1' })).toBeNull();
    expect(readOlistV3CallbackParams({})).toBeNull();
  });

  it('devolve null quando o usuário nega a autorização (error no lugar do code)', () => {
    expect(readOlistV3CallbackParams({ error: 'access_denied', state: 's1' })).toBeNull();
  });

  it('rejeita vazio, tipo errado e acima de 2048 caracteres', () => {
    expect(readOlistV3CallbackParams({ code: '', state: 's' })).toBeNull();
    expect(readOlistV3CallbackParams({ code: { a: 1 }, state: 's' })).toBeNull();
    expect(readOlistV3CallbackParams({ code: 'a'.repeat(2049), state: 's' })).toBeNull();
    expect(readOlistV3CallbackParams({ code: 'a'.repeat(2048), state: 's' })).not.toBeNull();
  });

  it('com parâmetro repetido usa o primeiro', () => {
    expect(readOlistV3CallbackParams({ code: ['c1', 'c2'], state: 's' })).toEqual({ code: 'c1', state: 's' });
  });
});
