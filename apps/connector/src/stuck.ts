/**
 * Segnale "non riesce a inviare": il punto esclamativo segue sempre lo stato, la notifica parte solo al passaggio a
 * bloccato. Lo stato è salvato: il worker si riaccende spesso e non deve avvisare di nuovo a ogni risveglio.
 */
export function stuckSignal(d: {
  load(): Promise<boolean>;
  save(stuck: boolean): Promise<void>;
  show(stuck: boolean): void;
  notify(): void;
}) {
  return async (stuck: boolean): Promise<void> => {
    d.show(stuck);
    if ((await d.load()) === stuck) return;
    await d.save(stuck);
    if (stuck) d.notify();
  };
}
