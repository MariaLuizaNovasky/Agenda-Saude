import { describe, expect, it } from 'vitest';
import { cpfValido, crmFormatoValido, somarDias, minutos, hhmm } from '../src/util.js';
import { somarMinutos } from '../src/agenda.js';

describe('validação de CPF', () => {
  it('aceita CPFs válidos (com ou sem máscara)', () => {
    expect(cpfValido('123.456.789-09')).toBe(true);
    expect(cpfValido('12345678909')).toBe(true);
  });
  it('rejeita dígitos verificadores errados, tamanho errado e sequências repetidas', () => {
    expect(cpfValido('123.456.789-10')).toBe(false);
    expect(cpfValido('1234567890')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
    expect(cpfValido('')).toBe(false);
  });
});

describe('formato do CRM', () => {
  it('aceita de 4 a 7 dígitos', () => {
    for (const c of ['1234', '123456', '1234567']) expect(crmFormatoValido(c)).toBe(true);
  });
  it('rejeita curto demais, longo demais e letras', () => {
    for (const c of ['123', '12345678', 'abcd', '']) expect(crmFormatoValido(c)).toBe(false);
  });
});

describe('datas e horários', () => {
  it('soma dias atravessando mês e ano', () => {
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('converte HH:MM e minutos', () => {
    expect(minutos('07:30')).toBe(450);
    expect(hhmm(450)).toBe('07:30');
  });
  it('soma minutos virando o dia', () => {
    expect(somarMinutos('2026-10-21T23:50', 20)).toBe('2026-10-22T00:10');
  });
});
