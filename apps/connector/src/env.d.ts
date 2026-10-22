interface ImportMetaEnv {
  /** Indirizzo del portale: API del connettore e unica origine dei messaggi esterni. */
  readonly WXT_PORTAL_URL: string;
  /** '1' solo nella build dei test end-to-end. */
  readonly WXT_SWEEP_FAST?: string;
}
