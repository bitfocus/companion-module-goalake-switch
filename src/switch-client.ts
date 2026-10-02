import { request as httpRequest } from 'node:http'

/**
 * Numeric `callcmd` ids of the switch's JSON-RPC-ish HTTP API.
 * The id doubles as the URL path: `POST /101`.
 * See README.md for the protocol constraints used by this client.
 */
export const CallCmd = {
	State: 100,
	Detail: 101,
	PortConfig: 103,
	Reboot: 104,
	Login: 123,
	Logout: 126,
	All: 200,
} as const

/** The device answers unauthenticated/unknown/overlapping requests by silently dropping the TCP connection. */
export class SwitchConnectionError extends Error {
	/** Node's system error code (e.g. ECONNRESET, ECONNREFUSED, ETIMEDOUT), if one could be found in the cause chain. */
	readonly code: string | undefined

	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'SwitchConnectionError'
		this.code = findNodeErrorCode(options?.cause)
	}
}

/** Walks an Error's `cause` chain looking for a Node system error `code` (e.g. from node:http/net). */
function findNodeErrorCode(e: unknown): string | undefined {
	let current = e
	for (let depth = 0; current !== undefined && depth < 5; depth++) {
		if (typeof current === 'object' && current !== null && 'code' in current) {
			const code = (current as { code?: unknown }).code
			if (typeof code === 'string') return code
		}
		current = current instanceof Error ? current.cause : undefined
	}
	return undefined
}

/** The device answered with a well-formed JSON envelope carrying a non-zero errcode. */
export class SwitchCommandError extends Error {
	readonly errcode: number

	constructor(callcmd: number, errcode: number, errmsg?: string) {
		super(`callcmd ${callcmd} failed: errcode=${errcode}${errmsg ? ` (${errmsg})` : ''}`)
		this.name = 'SwitchCommandError'
		this.errcode = errcode
	}
}

export interface SwitchResponse {
	errcode: number
	errmsg?: string
	calldata: Record<string, unknown>
}

export interface SwitchClientOptions {
	host: string
	port?: number
	/** Per-request socket timeout in ms. */
	timeout?: number
	/** Minimum gap between two requests; the embedded httpd is single-threaded. */
	minRequestInterval?: number
	/** Extra attempts after a dropped connection. */
	retries?: number
	retryDelay?: number
}

interface RawResponse {
	statusCode: number
	body: string
	setCookie: string[] | undefined
}

async function delay(ms: number): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * Client for the Realtek-reference "Easy Smart Managed" switch web API used by
 * Goalake and its OEM siblings.
 *
 * Two behaviours of the firmware drive the design of this class:
 * - only one session may be active at a time, device-wide;
 * - the httpd is single-threaded and answers anything it dislikes (bad auth,
 *   unknown path, too many concurrent connections) by closing the socket.
 *
 * All calls are therefore serialised through a single queue with a minimum gap,
 * and connection drops are retried before being surfaced as an error.
 */
export class SwitchClient {
	readonly #host: string
	readonly #port: number
	readonly #timeout: number
	readonly #minRequestInterval: number
	readonly #retries: number
	readonly #retryDelay: number

	#cookie: string | undefined
	#queue: Promise<unknown> = Promise.resolve()
	#lastRequestFinishedAt = 0

	constructor(options: SwitchClientOptions) {
		this.#host = options.host
		this.#port = options.port ?? 80
		this.#timeout = options.timeout ?? 5000
		this.#minRequestInterval = options.minRequestInterval ?? 500
		this.#retries = options.retries ?? 1
		this.#retryDelay = options.retryDelay ?? 750
	}

	get host(): string {
		return this.#host
	}

	get hasSession(): boolean {
		return this.#cookie !== undefined
	}

	/** Forget the session without talking to the device (e.g. after a fatal error). */
	clearSession(): void {
		this.#cookie = undefined
	}

	async login(password: string): Promise<void> {
		this.#cookie = undefined
		const response = await this.call(CallCmd.Login, { password })
		if (response.calldata.login !== 'success') {
			throw new SwitchConnectionError('login was rejected by the device')
		}
		if (!this.#cookie) {
			throw new SwitchConnectionError('login succeeded but the device did not return a session cookie')
		}
	}

	async logout(): Promise<void> {
		if (!this.#cookie) return
		try {
			await this.call(CallCmd.Logout)
		} finally {
			this.#cookie = undefined
		}
	}

	async getDetail(): Promise<Record<string, unknown>> {
		return (await this.call(CallCmd.Detail)).calldata
	}

	async getState(): Promise<Record<string, unknown>> {
		return (await this.call(CallCmd.State)).calldata
	}

	/** `opcode = mode | (portIndex << 4)`; see PortConfigMode. */
	async setPortConfig(opcode: number): Promise<void> {
		await this.call(CallCmd.PortConfig, { opcode })
	}

	/** Rebooting takes no calldata and happens immediately - there is no confirmation step. */
	async reboot(): Promise<void> {
		await this.call(CallCmd.Reboot)
		this.#cookie = undefined
	}

	async call(callcmd: number, calldata?: Record<string, unknown>): Promise<SwitchResponse> {
		return this.#enqueue(async () => {
			let lastError: unknown
			for (let attempt = 0; attempt <= this.#retries; attempt++) {
				if (attempt > 0) await delay(this.#retryDelay)
				try {
					return await this.#request(callcmd, calldata)
				} catch (e) {
					if (!(e instanceof SwitchConnectionError)) throw e
					lastError = e
				}
			}
			throw new SwitchConnectionError(
				`callcmd ${callcmd}: the device closed the connection after ${this.#retries + 1} attempt(s). ` +
					`This is also how it reports an expired session, a wrong password, or another client already logged in.`,
				{ cause: lastError },
			)
		})
	}

	async #request(callcmd: number, calldata?: Record<string, unknown>): Promise<SwitchResponse> {
		const body: Record<string, unknown> = { callcmd }
		if (calldata !== undefined) body.calldata = calldata
		const payload = JSON.stringify({ data: body })

		const raw = await this.#rawPost(`/${callcmd}`, payload)
		if (raw.statusCode !== 200) {
			throw new SwitchConnectionError(`callcmd ${callcmd}: unexpected HTTP status ${raw.statusCode}`)
		}

		// The session token is the cookie *name*; the value is empty.
		const cookie = raw.setCookie?.at(-1)?.split(';')[0]
		if (cookie) this.#cookie = cookie

		let parsed: unknown
		try {
			parsed = JSON.parse(raw.body)
		} catch (e) {
			throw new SwitchConnectionError(`callcmd ${callcmd}: response was not JSON`, { cause: e })
		}

		const envelope = (parsed ?? {}) as Record<string, unknown>
		const inner = (envelope.data ?? {}) as Record<string, unknown>
		const errcode = Number(envelope.errcode ?? inner.errcode ?? 0)
		const errmsg = (envelope.errmsg ?? inner.errmsg) as string | undefined
		// callcmd 126 (logout) confirms completion with errcode=1003 - that's not a failure.
		const isLogoutConfirmation = callcmd === CallCmd.Logout && errcode === 1003
		if (errcode !== 0 && !isLogoutConfirmation) {
			throw new SwitchCommandError(callcmd, errcode, errmsg)
		}

		return {
			errcode,
			errmsg,
			calldata: (inner.calldata ?? envelope.calldata ?? {}) as Record<string, unknown>,
		}
	}

	async #rawPost(path: string, payload: string): Promise<RawResponse> {
		return await new Promise<RawResponse>((resolve, reject) => {
			const headers: Record<string, string> = {
				'Content-Type': 'application/json; charset=utf-8',
				Accept: 'application/json, text/javascript, */*; q=0.01',
				'X-Requested-With': 'XMLHttpRequest',
				// The lwIP httpd copes far better with one request per connection.
				Connection: 'close',
				'Content-Length': String(Buffer.byteLength(payload)),
			}
			if (this.#cookie) headers.Cookie = this.#cookie

			const req = httpRequest(
				{ host: this.#host, port: this.#port, path, method: 'POST', headers, timeout: this.#timeout },
				(res) => {
					const chunks: Buffer[] = []
					res.on('data', (chunk: Buffer) => chunks.push(chunk))
					res.on('end', () => {
						resolve({
							statusCode: res.statusCode ?? 0,
							body: Buffer.concat(chunks).toString('utf8'),
							setCookie: res.headers['set-cookie'],
						})
					})
					res.on('error', (e) =>
						reject(new SwitchConnectionError(`response stream failed: ${e.message}`, { cause: e })),
					)
				},
			)

			req.on('timeout', () => {
				const timeoutError: NodeJS.ErrnoException = new Error(`no response within ${this.#timeout}ms`)
				timeoutError.code = 'ETIMEDOUT'
				req.destroy(timeoutError)
			})
			req.on('error', (e) => reject(new SwitchConnectionError(e.message, { cause: e })))
			req.end(payload)
		})
	}

	async #enqueue<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.#queue.then(async () => {
			const wait = this.#minRequestInterval - (Date.now() - this.#lastRequestFinishedAt)
			if (wait > 0) await delay(wait)
			try {
				return await fn()
			} finally {
				this.#lastRequestFinishedAt = Date.now()
			}
		})
		this.#queue = run.catch(() => undefined)
		return run
	}
}
