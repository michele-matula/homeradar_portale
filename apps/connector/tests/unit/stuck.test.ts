import { describe, expect, it, vi } from 'vitest';
import { stuckSignal } from '../../src/stuck';

function setup(saved: boolean) {
  let value = saved;
  const d = {
    load: async () => value,
    save: vi.fn(async (v: boolean) => {
      value = v;
    }),
    show: vi.fn(),
    notify: vi.fn(),
  };
  return { d, signal: stuckSignal(d) };
}

describe('avviso "non riesce a inviare"', () => {
  it('la notifica parte una volta sola, anche dopo un riavvio del worker', async () => {
    const { d, signal } = setup(false);
    await signal(true);
    expect(d.notify).toHaveBeenCalledTimes(1);
    // Worker riavviato: in memoria non sa più nulla, ma l'avviso era già stato dato.
    await stuckSignal(d)(true);
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.show).toHaveBeenLastCalledWith(true);
  });

  it('quando gli invii ripartono il segnale si spegne e un nuovo blocco avvisa di nuovo', async () => {
    const { d, signal } = setup(true);
    await signal(false);
    expect(d.show).toHaveBeenLastCalledWith(false);
    expect(d.save).toHaveBeenLastCalledWith(false);
    await signal(true);
    expect(d.notify).toHaveBeenCalledTimes(1);
  });
});
