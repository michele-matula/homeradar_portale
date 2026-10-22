import { z } from 'zod';

// Le estensioni non ammettono eval: senza questo zod prova `Function('')` per compilare gli schemi e Chrome segnala
// "Hash of blocked script" (innocuo, ma rumore). Va importato prima di ogni uso di zod.
z.config({ jitless: true });
