import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { DefaultConfig, GetConfigFields, type ModuleConfig, type ModuleSecrets } from './config.js'
import {
	UpdateVariableDefinitions,
	BuildVariableValues,
	BuildEmptyVariableValues,
	type VariablesSchema,
} from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { SwitchClient, SwitchCommandError, SwitchConnectionError } from './switch-client.js'
import {
	buildOpcode,
	parseDetail,
	portToIndex,
	PortConfigMode,
	type DeviceState,
	type PortConfigModeValue,
	type PortStatus,
} from './device-state.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: ModuleSecrets
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

/** Used for the action/feedback dropdowns until the device tells us its real port count. */
const AssumedPortCount = 5
const AssumedPoePortCount = 4

/** Backed off up to this ceiling once login/poll attempts keep failing, e.g. while another client holds the device's single session. */
const MaxPollBackoffMs = 300_000

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	#config: ModuleConfig = DefaultConfig
	#password = ''
	#client: SwitchClient | undefined
	#state: DeviceState | undefined
	#pollTimer: NodeJS.Timeout | undefined
	#loginPromise: Promise<void> | undefined
	#destroyed = false
	#consecutiveFailures = 0

	get portCount(): number {
		return this.#state?.portCount ?? AssumedPortCount
	}

	get poePortCount(): number {
		return this.#state?.poePortCount ?? AssumedPoePortCount
	}

	get isConnected(): boolean {
		return this.#state !== undefined
	}

	getPort(port: number): PortStatus | undefined {
		return this.#state?.ports.find((p) => p.port === port)
	}

	async init(config: ModuleConfig, _isFirstInit: boolean, secrets: ModuleSecrets): Promise<void> {
		this.#config = config
		this.#password = secrets?.password ?? ''

		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()

		this.#start()
	}

	async configUpdated(config: ModuleConfig, secrets: ModuleSecrets): Promise<void> {
		this.#config = config
		this.#password = secrets?.password ?? ''
		// The switch allows a single session device-wide, so the old one must be released first.
		await this.#stop()
		this.#start()
	}

	async destroy(): Promise<void> {
		this.#destroyed = true
		await this.#stop()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}

	async setPoe(port: number, on: boolean): Promise<void> {
		const index = portToIndex(port, this.poePortCount, this.portCount, this.#state?.reversedOrder ?? false)
		await this.#runCommand(async (client) => {
			await client.setPortConfig(buildOpcode(on ? PortConfigMode.PoeOn : PortConfigMode.PoeOff, index))
		})
		await this.pollNow()
	}

	/**
	 * @param fallback used when the device rejects the primary mode with errcode 1001,
	 * which is how 100M-only ports answer a 1G request.
	 */
	async setPortMode(port: number, mode: PortConfigModeValue, fallback?: PortConfigModeValue): Promise<void> {
		const index = portToIndex(port, this.poePortCount, this.portCount, this.#state?.reversedOrder ?? false)
		await this.#runCommand(async (client) => {
			try {
				await client.setPortConfig(buildOpcode(mode, index))
			} catch (e) {
				if (fallback === undefined || !(e instanceof SwitchCommandError) || e.errcode !== 1001) throw e
				this.log('debug', `Port ${port}: mode 0x${mode.toString(16)} was rejected; falling back`)
				await client.setPortConfig(buildOpcode(fallback, index))
			}
		})
		await this.pollNow()
	}

	async reboot(): Promise<void> {
		this.log('warn', 'Rebooting switch')
		await this.#runCommand(async (client) => {
			await client.reboot()
		})
		this.#setDisconnected('Rebooting')
	}

	async pollNow(): Promise<void> {
		if (this.#pollTimer) {
			clearTimeout(this.#pollTimer)
			this.#pollTimer = undefined
		}
		await this.#poll()
	}

	#start(): void {
		this.#destroyed = false
		this.#state = undefined
		this.#consecutiveFailures = 0

		if (!this.#config.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'Switch IP address is not configured')
			return
		}
		if (!this.#password) {
			this.updateStatus(InstanceStatus.BadConfig, 'Administrator password is not configured')
			return
		}

		this.#client = new SwitchClient({
			host: this.#config.host,
			timeout: Math.max(1, this.#config.requestTimeout) * 1000,
		})

		this.updateStatus(InstanceStatus.Connecting)
		// Deliberately not awaited: init/configUpdated must not block on the device.
		void this.#poll()
	}

	async #stop(): Promise<void> {
		if (this.#pollTimer) {
			clearTimeout(this.#pollTimer)
			this.#pollTimer = undefined
		}

		const client = this.#client
		this.#client = undefined
		this.#loginPromise = undefined
		this.#state = undefined

		if (client?.hasSession) {
			try {
				await client.logout()
			} catch (e) {
				// Leaving the session open only means waiting out the ~2 minute idle timeout.
				this.log('debug', `Logout failed: ${describeError(e)} - ${describeErrorDetail(e)}`)
			}
		}
	}

	async #runCommand<T>(fn: (client: SwitchClient) => Promise<T>): Promise<T> {
		const client = this.#client
		if (!client) throw new Error('Switch is not connected')

		try {
			await this.#ensureSession(client)
			return await fn(client)
		} catch (e) {
			client.clearSession()
			this.#setDisconnected(this.#describeAndLogError(e))
			throw e
		}
	}

	async #ensureSession(client: SwitchClient): Promise<void> {
		if (client.hasSession) return
		this.#loginPromise ??= client.login(this.#password).finally(() => {
			this.#loginPromise = undefined
		})
		await this.#loginPromise
	}

	async #poll(): Promise<void> {
		const client = this.#client
		if (!client || this.#destroyed) return

		try {
			await this.#ensureSession(client)
			const calldata = await client.getDetail()
			this.#applyDetail(calldata)
		} catch (e) {
			client.clearSession()
			this.#setDisconnected(this.#describeAndLogError(e))
		} finally {
			this.#scheduleNextPoll()
		}
	}

	/** Logs the full error detail (with cause chain) and returns the short message shown in the connection status. */
	#describeAndLogError(e: unknown): string {
		const message = describeError(e)
		this.log('warn', `${message} - ${describeErrorDetail(e)}`)
		return message
	}

	#applyDetail(calldata: Record<string, unknown>): void {
		const previous = this.#state
		const state = parseDetail(calldata, this.#config.portOrder)
		this.#state = state

		const layoutChanged =
			previous === undefined || previous.portCount !== state.portCount || previous.poePortCount !== state.poePortCount

		if (layoutChanged) {
			this.updateActions()
			this.updateFeedbacks()
			this.updatePresets()
			this.updateVariableDefinitions()
		}

		this.setVariableValues(BuildVariableValues(state))
		this.checkAllFeedbacks()
		this.updateStatus(InstanceStatus.Ok)
		this.#consecutiveFailures = 0
	}

	#setDisconnected(message: string): void {
		const portCount = this.portCount
		const poePortCount = this.poePortCount
		this.#state = undefined
		this.setVariableValues(BuildEmptyVariableValues(portCount, poePortCount))
		this.checkAllFeedbacks()
		this.updateStatus(InstanceStatus.ConnectionFailure, message)
		this.#consecutiveFailures++
	}

	#scheduleNextPoll(): void {
		if (this.#destroyed || !this.#client || this.#pollTimer) return
		const intervalMs = this.#nextPollDelayMs()
		if (this.#consecutiveFailures > 1) {
			this.log(
				'debug',
				`Backing off after ${this.#consecutiveFailures} consecutive failures: retrying in ${Math.round(intervalMs / 1000)}s`,
			)
		}
		this.#pollTimer = setTimeout(() => {
			this.#pollTimer = undefined
			void this.#poll()
		}, intervalMs)
	}

	/** Doubles the poll interval per consecutive failure, capped at MaxPollBackoffMs, to avoid hammering a session held by another client. */
	#nextPollDelayMs(): number {
		const baseMs = Math.max(1, this.#config.pollInterval) * 1000
		if (this.#consecutiveFailures === 0) return baseMs
		const backoffMs = baseMs * 2 ** Math.min(this.#consecutiveFailures - 1, 10)
		return Math.min(backoffMs, MaxPollBackoffMs)
	}
}

function describeError(e: unknown): string {
	if (e instanceof SwitchConnectionError) {
		switch (e.code) {
			case 'ECONNREFUSED':
				return 'Cannot reach the switch (connection refused) - check the IP address and that the switch is powered on'
			case 'EHOSTUNREACH':
			case 'ENETUNREACH':
				return 'Cannot reach the switch (network unreachable) - check cabling/routing to the switch'
			case 'ENOTFOUND':
			case 'EAI_AGAIN':
				return 'Cannot resolve the switch address - check the configured IP address'
			case 'ETIMEDOUT':
				return 'The switch did not respond in time - check the network connection or increase the request timeout'
			case 'ECONNRESET':
				return 'The switch closed the connection - likely a wrong password, another active session (e.g. its web admin page open in a browser), or a rejected request'
			default:
				return 'Connection failed (incorrect password, another session, or network failure)'
		}
	}
	if (e instanceof SwitchCommandError) {
		if (e.errcode === 1001) {
			return 'Switch rejected the command: the port does not support the requested mode (errcode=1001)'
		}
		return `Switch rejected the command (errcode=${e.errcode})`
	}
	return e instanceof Error ? e.message : String(e)
}

/** Full diagnostic detail (error name, node error code, cause chain) for the connection log - not shown in the status bar. */
function describeErrorDetail(e: unknown): string {
	const parts: string[] = []
	let current: unknown = e
	for (let depth = 0; current !== undefined && depth < 5; depth++) {
		if (current instanceof Error) {
			const code = (current as NodeJS.ErrnoException).code
			parts.push(`${current.name}: ${current.message}${code ? ` [${code}]` : ''}`)
			current = current.cause
		} else {
			parts.push(typeof current === 'string' ? current : JSON.stringify(current))
			break
		}
	}
	return parts.join(' <- caused by: ')
}
