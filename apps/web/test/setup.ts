import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom non implementa lo scorrimento della finestra.
window.scrollTo = () => {};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
