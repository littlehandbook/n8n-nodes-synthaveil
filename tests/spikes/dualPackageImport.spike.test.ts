/**
 * SPIKE — not part of the real C2a suite. [C-7](a) evidence for
 * docs/proj-n8n-integration/b1-threat-model-and-custody-design.md.
 *
 * Probes whether `@synthaveil/restore-protocol` (tsdown dual CJS/ESM build)
 * resolves cleanly when imported through this package's exact jest config
 * (ts-jest, CommonJS transform, esModuleInterop: true — see jest.config.js).
 *
 * This test requires a node_modules/@synthaveil/restore-protocol symlink
 * (created manually for the spike; restore-protocol is not yet a real
 * dependency of this package — that's C1/C0, both gated behind B1+F0). If the
 * symlink is absent, this file is skipped rather than failed, so it does not
 * break `npm test` for anyone who hasn't set the spike up.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

const spikePkgPresent = existsSync(
	join(__dirname, '../../node_modules/@synthaveil/restore-protocol'),
);

const describeIfPresent = spikePkgPresent ? describe : describe.skip;

describeIfPresent('[SPIKE] ts-jest dual-package import of @synthaveil/restore-protocol', () => {
	it('imports via static ES `import` syntax (ts-jest transpiles to CJS require)', () => {
		// This is the syntax C2a's real implementation would use.
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const mod = require('@synthaveil/restore-protocol') as typeof import('@synthaveil/restore-protocol');

		// Named exports C2a's decrypt pipeline calls directly (PROTOCOL.md §7/§4).
		expect(typeof mod.openEnvelope).toBe('function');
		expect(typeof mod.restoreStructured).toBe('function');
		expect(typeof mod.buildEntryAad).toBe('function');
	});

	it('resolves via CJS `require` to the .cjs entry point (exports map "require" condition)', () => {
		const resolved = require.resolve('@synthaveil/restore-protocol');
		expect(resolved.endsWith('.cjs')).toBe(true);
	});
});
