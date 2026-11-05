import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Con il PC carico (build, wrangler, altre suite) il primo render di un file può superare il secondo predefinito di findBy/waitFor.
configure({ asyncUtilTimeout: 4000 });

// jsdom non implementa lo scorrimento della finestra.
window.scrollTo = () => {};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
