function getDelayMs(): number {
    const raw = process.env.TINYCLAW_FAKE_PROVIDER_DELAY_MS;
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getMode(): 'success' | 'always-fail' {
    return process.env.TINYCLAW_FAKE_PROVIDER_MODE === 'always-fail'
        ? 'always-fail'
        : 'success';
}

export async function fakeProvider(prompt: string): Promise<string> {
    const delayMs = getDelayMs();
    if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    if (getMode() === 'always-fail') {
        throw new Error('simulated failure');
    }

    return `FAKE_RESPONSE:${prompt}`;
}
