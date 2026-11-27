import { render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import type { ReactNode } from 'react';
// Use the real widget library; only browser APIs absent from jsdom are supplied.
export function renderUI(children: ReactNode) {
    return render(<MantineProvider env="test">{children}</MantineProvider>);
}
export function jsonResponse(data: unknown, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => data,
        text: async () => JSON.stringify(data),
        headers: new Headers({ 'Content-Type': 'application/json' }),
    } as Response;
}
export function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
