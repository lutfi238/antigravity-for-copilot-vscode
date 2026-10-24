import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { formatTimeoutMessage, waitForCode } from '../src/auth/oauth';

describe('oauth waitForCode', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('cleans up listener and timer on successful code resolution', async () => {
		const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
		const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
		const disposeSpy = vi.fn();
		const token: vscode.CancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: vi.fn(() => ({ dispose: disposeSpy })),
		};

		let resolvePending!: (code: string) => void;
		const pending = new Promise<string>((resolve) => {
			resolvePending = resolve;
		});

		const resultPromise = waitForCode(pending, token);
		expect(vi.getTimerCount()).toBe(1);
		const timer = setTimeoutSpy.mock.results[0].value;

		resolvePending('auth-code-abc');

		const code = await resultPromise;
		expect(code).toBe('auth-code-abc');
		expect(disposeSpy).toHaveBeenCalledOnce();
		expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
		expect(vi.getTimerCount()).toBe(0);

		// Advancing timers further proves the timer was cancelled and will not fire
		vi.advanceTimersByTime(5 * 60_000);
		expect(disposeSpy).toHaveBeenCalledOnce();
	});

	it('rejects immediately without setting timer or registering listener if pre-cancelled', async () => {
		const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
		const token: vscode.CancellationToken = {
			isCancellationRequested: true,
			onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
		};

		const pending = new Promise<string>(() => {});
		await expect(waitForCode(pending, token)).rejects.toBeInstanceOf(vscode.CancellationError);
		expect(token.onCancellationRequested).not.toHaveBeenCalled();
		expect(setTimeoutSpy).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('cleans up and rejects if token becomes cancelled immediately during registration', async () => {
		const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
		const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
		const disposeSpy = vi.fn();
		let tokenState = false;
		const token: vscode.CancellationToken = {
			get isCancellationRequested() {
				return tokenState;
			},
			onCancellationRequested: vi.fn(() => {
				tokenState = true;
				return { dispose: disposeSpy };
			}),
		};

		const pending = new Promise<string>(() => {});
		await expect(waitForCode(pending, token)).rejects.toBeInstanceOf(vscode.CancellationError);
		const timer = setTimeoutSpy.mock.results[0]?.value;
		expect(disposeSpy).toHaveBeenCalledOnce();
		expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('disposes subscription when cancellation callback fires synchronously during listener registration', async () => {
		const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
		const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
		const disposeSpy = vi.fn();

		const token: vscode.CancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: vi.fn((listener: () => void) => {
				// Fire the cancellation listener synchronously inside registration
				listener();
				return { dispose: disposeSpy };
			}),
		};

		const pending = new Promise<string>(() => {});
		await expect(waitForCode(pending, token)).rejects.toBeInstanceOf(vscode.CancellationError);

		const timer = setTimeoutSpy.mock.results[0]?.value;
		expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
		expect(disposeSpy).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('cleans up listener and timer when cancelled in flight', async () => {
		const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
		const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
		const disposeSpy = vi.fn();
		let cancelCallback!: () => void;
		const token: vscode.CancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: vi.fn((listener: () => void) => {
				cancelCallback = listener;
				return { dispose: disposeSpy };
			}),
		};

		const pending = new Promise<string>(() => {});
		const resultPromise = waitForCode(pending, token);
		expect(vi.getTimerCount()).toBe(1);
		const timer = setTimeoutSpy.mock.results[0].value;

		cancelCallback();

		await expect(resultPromise).rejects.toBeInstanceOf(vscode.CancellationError);
		expect(disposeSpy).toHaveBeenCalledOnce();
		expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
		expect(vi.getTimerCount()).toBe(0);

		// Advancing timers further proves the timeout was cancelled
		vi.advanceTimersByTime(5 * 60_000);
		expect(disposeSpy).toHaveBeenCalledOnce();
	});

	it('cleans up listener and timer when pending promise rejects with error', async () => {
		const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
		const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
		const disposeSpy = vi.fn();
		const token: vscode.CancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: vi.fn(() => ({ dispose: disposeSpy })),
		};

		let rejectPending!: (error: Error) => void;
		const pending = new Promise<string>((_, reject) => {
			rejectPending = reject;
		});

		const resultPromise = waitForCode(pending, token);
		expect(vi.getTimerCount()).toBe(1);
		const timer = setTimeoutSpy.mock.results[0].value;

		rejectPending(new Error('OAuth server returned access_denied'));

		await expect(resultPromise).rejects.toThrow('OAuth server returned access_denied');
		expect(disposeSpy).toHaveBeenCalledOnce();
		expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
		expect(vi.getTimerCount()).toBe(0);

		// Advancing timers further proves the timeout was cancelled
		vi.advanceTimersByTime(5 * 60_000);
		expect(disposeSpy).toHaveBeenCalledOnce();
	});

	it('cleans up listener and timer when timeout occurs', async () => {
		const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
		const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
		const disposeSpy = vi.fn();
		const token: vscode.CancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: vi.fn(() => ({ dispose: disposeSpy })),
		};

		const pending = new Promise<string>(() => {});
		const resultPromise = waitForCode(pending, token, 5000);
		expect(vi.getTimerCount()).toBe(1);
		const timer = setTimeoutSpy.mock.results[0].value;

		vi.advanceTimersByTime(5000);

		await expect(resultPromise).rejects.toThrow('Sign-in timed out after 5 seconds');
		expect(disposeSpy).toHaveBeenCalledOnce();
		expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('uses 5 minutes as the default timeout and cleans up upon firing', async () => {
		const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
		const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
		const disposeSpy = vi.fn();
		const token: vscode.CancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: vi.fn(() => ({ dispose: disposeSpy })),
		};

		const pending = new Promise<string>(() => {});
		const resultPromise = waitForCode(pending, token);
		expect(vi.getTimerCount()).toBe(1);
		const timer = setTimeoutSpy.mock.results[0].value;

		// Advance 4 minutes and 59 seconds -> should still be pending and timer still in queue
		vi.advanceTimersByTime(4 * 60_000 + 59_000);
		expect(disposeSpy).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(1);

		// Advance remaining 1 second -> hits exactly 5 minutes
		vi.advanceTimersByTime(1_000);

		await expect(resultPromise).rejects.toThrow('Sign-in timed out after 5 minutes');
		expect(disposeSpy).toHaveBeenCalledOnce();
		expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('ignores late pending resolution once settled by cancellation without redundant cleanup', async () => {
		const disposeSpy = vi.fn();
		let cancelCallback!: () => void;
		const token: vscode.CancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: vi.fn((listener: () => void) => {
				cancelCallback = listener;
				return { dispose: disposeSpy };
			}),
		};

		let resolvePending!: (code: string) => void;
		const pending = new Promise<string>((resolve) => {
			resolvePending = resolve;
		});

		const resultPromise = waitForCode(pending, token);
		cancelCallback();
		await expect(resultPromise).rejects.toBeInstanceOf(vscode.CancellationError);

		// Late resolve after cancellation should not re-trigger dispose or alter state
		resolvePending('late-code');
		await Promise.resolve();
		await Promise.resolve();
		expect(disposeSpy).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('ignores late pending rejection once settled by timeout without unhandled rejection', async () => {
		const disposeSpy = vi.fn();
		const token: vscode.CancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: vi.fn(() => ({ dispose: disposeSpy })),
		};

		let rejectPending!: (error: Error) => void;
		const pending = new Promise<string>((_, reject) => {
			rejectPending = reject;
		});

		const resultPromise = waitForCode(pending, token, 1000);
		vi.advanceTimersByTime(1000);

		await expect(resultPromise).rejects.toThrow('Sign-in timed out after 1 second');
		expect(disposeSpy).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);

		// Late rejection on pending should be cleanly handled without unhandled rejection
		rejectPending(new Error('Late network error'));
		await Promise.resolve();
		await Promise.resolve();
		expect(disposeSpy).toHaveBeenCalledOnce();
	});

	it('cleans up timer if onCancellationRequested throws synchronously', async () => {
		const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
		const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
		const token: vscode.CancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: vi.fn(() => {
				throw new Error('Registration failed');
			}),
		};

		const pending = new Promise<string>(() => {});
		await expect(waitForCode(pending, token)).rejects.toThrow('Registration failed');
		const timer = setTimeoutSpy.mock.results[0]?.value;
		expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('formats custom timeout error messages accurately', () => {
		expect(formatTimeoutMessage(0)).toBe('Sign-in timed out immediately');
		expect(formatTimeoutMessage(-100)).toBe('Sign-in timed out immediately');
		expect(formatTimeoutMessage(NaN)).toBe('Sign-in timed out immediately');
		expect(formatTimeoutMessage(Infinity)).toBe('Sign-in timed out immediately');
		expect(formatTimeoutMessage(1000)).toBe('Sign-in timed out after 1 second');
		expect(formatTimeoutMessage(15_000)).toBe('Sign-in timed out after 15 seconds');
		expect(formatTimeoutMessage(60_000)).toBe('Sign-in timed out after 1 minute');
		expect(formatTimeoutMessage(120_000)).toBe('Sign-in timed out after 2 minutes');
		expect(formatTimeoutMessage(300_000)).toBe('Sign-in timed out after 5 minutes');
		expect(formatTimeoutMessage(750)).toBe('Sign-in timed out after 750ms');
	});

	it('rejects with custom duration message when timeoutMs is specified', async () => {
		const tokenMinute: vscode.CancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
		};

		// Test 1 minute custom timeout
		const pendingMinute = new Promise<string>(() => {});
		const promiseMinute = waitForCode(pendingMinute, tokenMinute, 60_000);
		vi.advanceTimersByTime(60_000);
		await expect(promiseMinute).rejects.toThrow('Sign-in timed out after 1 minute');

		// Test millisecond custom timeout
		const tokenMs: vscode.CancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
		};
		const pendingMs = new Promise<string>(() => {});
		const promiseMs = waitForCode(pendingMs, tokenMs, 750);
		vi.advanceTimersByTime(750);
		await expect(promiseMs).rejects.toThrow('Sign-in timed out after 750ms');
	});

	it('ensures cancelled timeout does not trigger a late rejection when time advances past the timeout limit', async () => {
		const unhandledRejections: unknown[] = [];
		const onUnhandled = (reason: unknown) => {
			unhandledRejections.push(reason);
		};
		process.on('unhandledRejection', onUnhandled);

		try {
			const disposeSpy = vi.fn();
			let cancelCallback!: () => void;
			const token: vscode.CancellationToken = {
				isCancellationRequested: false,
				onCancellationRequested: vi.fn((listener: () => void) => {
					cancelCallback = listener;
					return { dispose: disposeSpy };
				}),
			};

			const pending = new Promise<string>(() => {});
			const resultPromise = waitForCode(pending, token, 2000);

			// Cancel at 500ms
			vi.advanceTimersByTime(500);
			cancelCallback();

			await expect(resultPromise).rejects.toBeInstanceOf(vscode.CancellationError);
			expect(disposeSpy).toHaveBeenCalledOnce();
			expect(vi.getTimerCount()).toBe(0);

			// Advance time well past the original 2000ms timeout
			vi.advanceTimersByTime(5000);
			await Promise.resolve();
			await Promise.resolve();

			expect(unhandledRejections).toHaveLength(0);
		} finally {
			process.off('unhandledRejection', onUnhandled);
		}
	});

	it('pre-cancelled token rejects immediately even if source promise is already resolved', async () => {
		const token: vscode.CancellationToken = {
			isCancellationRequested: true,
			onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
		};

		const pending = Promise.resolve('code-already-ready');
		await expect(waitForCode(pending, token)).rejects.toBeInstanceOf(vscode.CancellationError);
		expect(token.onCancellationRequested).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('pre-cancelled token rejects immediately and safely absorbs source promise rejection without unhandled rejection', async () => {
		const unhandledRejections: unknown[] = [];
		const onUnhandled = (reason: unknown) => {
			unhandledRejections.push(reason);
		};
		process.on('unhandledRejection', onUnhandled);

		try {
			const token: vscode.CancellationToken = {
				isCancellationRequested: true,
				onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
			};

			let rejectPending!: (error: Error) => void;
			const pending = new Promise<string>((_, reject) => {
				rejectPending = reject;
			});

			const resultPromise = waitForCode(pending, token);
			await expect(resultPromise).rejects.toBeInstanceOf(vscode.CancellationError);

			// Source promise rejects after early exit
			rejectPending(new Error('Server failed to start'));
			await Promise.resolve();
			await Promise.resolve();

			expect(unhandledRejections).toHaveLength(0);
		} finally {
			process.off('unhandledRejection', onUnhandled);
		}
	});

	it('race: cancellation and timeout occurring at the exact same tick settles deterministically', async () => {
		const disposeSpy = vi.fn();
		let cancelCallback!: () => void;
		const token: vscode.CancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: vi.fn((listener: () => void) => {
				cancelCallback = listener;
				return { dispose: disposeSpy };
			}),
		};

		const pending = new Promise<string>(() => {});
		const resultPromise = waitForCode(pending, token, 1000);

		// Trigger cancellation and advance timer to timeout simultaneously in the same tick
		cancelCallback();
		vi.advanceTimersByTime(1000);

		// The cancellation triggered first synchronously, so it wins
		await expect(resultPromise).rejects.toBeInstanceOf(vscode.CancellationError);
		expect(disposeSpy).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('race: source promise resolution completing right before timer fires wins without double cleanup', async () => {
		const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
		const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
		const disposeSpy = vi.fn();
		const token: vscode.CancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: vi.fn(() => ({ dispose: disposeSpy })),
		};

		let resolvePending!: (code: string) => void;
		const pending = new Promise<string>((resolve) => {
			resolvePending = resolve;
		});

		const resultPromise = waitForCode(pending, token, 1000);
		const timer = setTimeoutSpy.mock.results[0].value;

		// Resolve pending right before timeout fires
		resolvePending('winning-code');
		await Promise.resolve();
		vi.advanceTimersByTime(1000);

		const code = await resultPromise;
		expect(code).toBe('winning-code');
		expect(disposeSpy).toHaveBeenCalledOnce();
		expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('race: timeout firing right before source promise resolution wins without double cleanup', async () => {
		const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
		const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
		const disposeSpy = vi.fn();
		const token: vscode.CancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: vi.fn(() => ({ dispose: disposeSpy })),
		};

		let resolvePending!: (code: string) => void;
		const pending = new Promise<string>((resolve) => {
			resolvePending = resolve;
		});

		const resultPromise = waitForCode(pending, token, 1000);
		const timer = setTimeoutSpy.mock.results[0].value;

		// Timer fires at 1000ms
		vi.advanceTimersByTime(1000);
		// Source promise resolves right after timeout fired
		resolvePending('late-code');
		await Promise.resolve();

		await expect(resultPromise).rejects.toThrow('Sign-in timed out after 1 second');
		expect(disposeSpy).toHaveBeenCalledOnce();
		expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('race: source promise resolution and cancellation in the same tick settles cleanly', async () => {
		const disposeSpy = vi.fn();
		let cancelCallback!: () => void;
		const token: vscode.CancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: vi.fn((listener: () => void) => {
				cancelCallback = listener;
				return { dispose: disposeSpy };
			}),
		};

		let resolvePending!: (code: string) => void;
		const pending = new Promise<string>((resolve) => {
			resolvePending = resolve;
		});

		const resultPromise = waitForCode(pending, token);

		// Cancel synchronously before pending microtask resolves
		cancelCallback();
		resolvePending('code-arrived-too-late');

		await expect(resultPromise).rejects.toBeInstanceOf(vscode.CancellationError);
		expect(disposeSpy).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('absorbs late pending rejection when cancelled immediately during registration', async () => {
		const unhandledRejections: unknown[] = [];
		const onUnhandled = (reason: unknown) => {
			unhandledRejections.push(reason);
		};
		process.on('unhandledRejection', onUnhandled);

		try {
			const disposeSpy = vi.fn();
			let tokenState = false;
			const token: vscode.CancellationToken = {
				get isCancellationRequested() {
					return tokenState;
				},
				onCancellationRequested: vi.fn(() => {
					tokenState = true;
					return { dispose: disposeSpy };
				}),
			};

			let rejectPending!: (error: Error) => void;
			const pending = new Promise<string>((_, reject) => {
				rejectPending = reject;
			});

			const resultPromise = waitForCode(pending, token);
			await expect(resultPromise).rejects.toBeInstanceOf(vscode.CancellationError);

			// Reject pending after the early return in registration
			rejectPending(new Error('Late registration error'));
			await Promise.resolve();
			await Promise.resolve();

			expect(unhandledRejections).toHaveLength(0);
		} finally {
			process.off('unhandledRejection', onUnhandled);
		}
	});
});
