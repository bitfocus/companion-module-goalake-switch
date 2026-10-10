import assert from 'node:assert/strict'
import { describe, it, type TestContext } from 'node:test'
import { InstanceStatus } from '@companion-module/base'
import { DefaultConfig, type ModuleConfig } from './config.js'
import { PortConfigMode, PortConfigValidationError } from './device-state.js'
import ModuleInstance from './main.js'
import { SwitchClient, SwitchCommandError } from './switch-client.js'

const detailFixture = {
	sn: 'PS104GV3TEST',
	poec: [1, 1, 0, 0],
	pw: [0, 0, 0, 0],
	phyc: [4, 4, 5, 5, 5],
	link: [0, 0, 0, 0, 5],
}

function createHarness(context: TestContext) {
	const statuses: InstanceStatus[] = []
	const sessions = new Set<SwitchClient>()
	const instance = new ModuleInstance({
		id: 'test',
		_isInstanceContext: true,
		setActionDefinitions: () => undefined,
		setFeedbackDefinitions: () => undefined,
		setPresetDefinitions: () => undefined,
		setVariableDefinitions: () => undefined,
		setVariableValues: () => undefined,
		checkAllFeedbacks: () => undefined,
		updateStatus: (status: InstanceStatus) => statuses.push(status),
	})
	context.mock.method(instance, 'log', () => undefined)
	context.mock.method(
		SwitchClient.prototype,
		'hasSession',
		function (this: SwitchClient) {
			return sessions.has(this)
		},
		{ getter: true },
	)
	const login = context.mock.method(SwitchClient.prototype, 'login', async function (this: SwitchClient) {
		sessions.add(this)
	})
	context.mock.method(SwitchClient.prototype, 'clearSession', function (this: SwitchClient) {
		sessions.delete(this)
	})
	context.mock.method(SwitchClient.prototype, 'logout', async function (this: SwitchClient) {
		sessions.delete(this)
	})
	const detail = context.mock.method(
		SwitchClient.prototype,
		'getDetail',
		async (): Promise<Record<string, unknown>> => detailFixture,
	)
	const writes = context.mock.method(SwitchClient.prototype, 'setPortConfig', async (_opcode: number) => undefined)
	context.mock.method(SwitchClient.prototype, 'reboot', async () => undefined)
	context.after(async () => instance.destroy())
	const config: ModuleConfig = { ...DefaultConfig, host: '192.0.2.1', pollInterval: 60 }
	return { instance, config, detail, writes, statuses, sessions, login }
}

describe('port commands', () => {
	it('acquires unknown startup state before sending the reversed-port opcode', async (context) => {
		const { instance, config, detail, writes } = createHarness(context)
		const pendingDetail = Promise.withResolvers<typeof detailFixture>()
		detail.mock.mockImplementation(async () => pendingDetail.promise)
		await instance.init(config, false, { password: 'test' })
		const command = instance.setPoe(1, false)
		await Promise.resolve()
		assert.equal(writes.mock.callCount(), 0)
		pendingDetail.resolve(detailFixture)
		await command
		assert.deepEqual(
			writes.mock.calls.map((call) => call.arguments[0]),
			[50],
		)
	})

	it('rejects writes if state acquisition fails', async (context) => {
		const { instance, config, detail, writes } = createHarness(context)
		detail.mock.mockImplementation(async () => {
			throw new Error('detail unavailable')
		})
		await instance.init(config, false, { password: 'test' })
		await assert.rejects(instance.setPoe(1, false), /detail unavailable/)
		await assert.rejects(instance.setPortMode(1, PortConfigMode.Speed100MFull), /detail unavailable/)
		assert.equal(writes.mock.callCount(), 0)
	})

	it('keeps the same reversed index for the speed fallback', async (context) => {
		const { instance, config, writes } = createHarness(context)
		writes.mock.mockImplementationOnce(async () => {
			throw new SwitchCommandError(103, 1001)
		})
		await instance.init(config, false, { password: 'test' })
		await instance.setPortMode(3, PortConfigMode.Speed1GFull, PortConfigMode.Speed100MFull)
		assert.deepEqual(
			writes.mock.calls.map((call) => call.arguments[0]),
			[2576, 2064],
		)
	})

	it('does not treat an invalid target as a connection failure', async (context) => {
		const { instance, config, writes, statuses, sessions } = createHarness(context)
		await instance.init(config, false, { password: 'test' })
		await instance.pollNow()
		await assert.rejects(instance.setPoe(5, false), PortConfigValidationError)
		assert.equal(writes.mock.callCount(), 0)
		assert.equal(instance.isConnected, true)
		assert.equal(statuses.at(-1), InstanceStatus.Ok)
		assert.equal(sessions.size, 1)
	})

	it('does not reacquire known state until the post-command poll', async (context) => {
		const { instance, config, detail, writes } = createHarness(context)
		await instance.init(config, false, { password: 'test' })
		await instance.pollNow()
		detail.mock.resetCalls()
		writes.mock.mockImplementation(async () => {
			assert.equal(detail.mock.callCount(), 0)
		})
		await instance.setPoe(1, true)
		assert.deepEqual(
			writes.mock.calls.map((call) => call.arguments[0]),
			[562],
		)
		assert.equal(detail.mock.callCount(), 1)
	})

	it('reacquires state after a failed poll', async (context) => {
		const { instance, config, detail, writes } = createHarness(context)
		await instance.init(config, false, { password: 'test' })
		await instance.pollNow()
		detail.mock.mockImplementationOnce(async () => {
			throw new Error('poll failed')
		})
		await instance.pollNow()
		assert.equal(instance.isConnected, false)
		await instance.setPoe(1, false)
		assert.deepEqual(
			writes.mock.calls.map((call) => call.arguments[0]),
			[50],
		)
	})

	it('reacquires state after a failed action', async (context) => {
		const { instance, config, writes } = createHarness(context)
		await instance.init(config, false, { password: 'test' })
		writes.mock.mockImplementationOnce(async () => {
			throw new Error('write failed')
		})
		await assert.rejects(instance.setPoe(1, false), /write failed/)
		assert.equal(instance.isConnected, false)
		await instance.setPoe(1, true)
		assert.deepEqual(
			writes.mock.calls.map((call) => call.arguments[0]),
			[50, 562],
		)
	})

	it('keeps reboot independent of detail reads, then reacquires state for port commands', async (context) => {
		const { instance, config, detail, writes } = createHarness(context)
		await instance.init(config, false, { password: 'test' })
		await instance.pollNow()
		detail.mock.mockImplementation(async () => {
			throw new Error('unavailable after reboot')
		})
		await instance.pollNow()
		detail.mock.resetCalls()
		await instance.reboot()
		assert.equal(detail.mock.callCount(), 0)
		assert.equal(instance.isConnected, false)
		detail.mock.mockImplementation(async () => detailFixture)
		await instance.setPoe(1, false)
		assert.deepEqual(
			writes.mock.calls.map((call) => call.arguments[0]),
			[50],
		)
	})

	for (const order of ['auto', 'normal', 'reversed'] as const) {
		it(`honours ${order} order and actual counts on unknown state`, async (context) => {
			const { instance, config, detail, writes } = createHarness(context)
			detail.mock.mockImplementation(async () => ({
				...(order === 'auto' ? { sn: 'PS104GV3TEST' } : {}),
				link: [5, 5, 5],
				poec: [1, 1],
			}))
			await instance.init({ ...config, portOrder: order }, false, { password: 'test' })
			await instance.setPoe(1, false)
			await instance.setPortMode(3, PortConfigMode.Speed1GFull)
			assert.deepEqual(
				writes.mock.calls.map((call) => call.arguments[0]),
				[order === 'normal' ? 2 : 18, 2592],
			)
		})
	}

	for (const malformed of [{}, { link: [5], pw: [0, 0] }, { ...detailFixture, sn: undefined }]) {
		it(`refuses writes with incomplete state: ${JSON.stringify(malformed)}`, async (context) => {
			const { instance, config, detail, writes } = createHarness(context)
			detail.mock.mockImplementation(async () => malformed)
			await instance.init(config, false, { password: 'test' })
			await assert.rejects(instance.setPoe(1, false), PortConfigValidationError)
			await assert.rejects(instance.setPortMode(1, PortConfigMode.Speed1GFull), PortConfigValidationError)
			assert.equal(writes.mock.callCount(), 0)
		})
	}

	it('does not use the speed fallback for other errors', async (context) => {
		const { instance, config, writes } = createHarness(context)
		writes.mock.mockImplementation(async () => {
			throw new SwitchCommandError(103, -1)
		})
		await instance.init(config, false, { password: 'test' })
		await assert.rejects(instance.setPortMode(3, PortConfigMode.Speed1GFull, PortConfigMode.Speed100MFull))
		assert.equal(writes.mock.callCount(), 1)
	})

	for (const stop of ['configUpdated', 'destroy'] as const) {
		it(`cancels a pending detail read on ${stop}`, async (context) => {
			const { instance, config, detail, writes } = createHarness(context)
			const pendingDetail = Promise.withResolvers<typeof detailFixture>()
			const commandReading = Promise.withResolvers<void>()
			let reads = 0
			detail.mock.mockImplementation(async function (this: SwitchClient) {
				if (this.host === '192.0.2.2') return { ...detailFixture, sn: 'PS308GTEST' }
				if (++reads === 2) commandReading.resolve()
				return pendingDetail.promise
			})
			await instance.init(config, false, { password: 'test' })
			const command = instance.setPoe(1, false)
			const rejected = assert.rejects(command, /接続が変更または削除/)
			await commandReading.promise
			if (stop === 'configUpdated') {
				await instance.configUpdated({ ...config, host: '192.0.2.2' }, { password: 'test' })
				await instance.pollNow()
			} else {
				await instance.destroy()
			}
			pendingDetail.resolve(detailFixture)
			await rejected
			assert.equal(writes.mock.callCount(), 0)
			assert.equal(instance.isConnected, stop === 'configUpdated')
			if (stop === 'configUpdated') assert.equal(instance.getPort(1)?.index, 0)
		})
	}

	it('does not continue a speed fallback after the connection is replaced', async (context) => {
		const { instance, config, writes } = createHarness(context)
		const pendingWrite = Promise.withResolvers<void>()
		const writing = Promise.withResolvers<void>()
		writes.mock.mockImplementation(async () => {
			writing.resolve()
			return pendingWrite.promise
		})
		await instance.init(config, false, { password: 'test' })
		const command = instance.setPortMode(3, PortConfigMode.Speed1GFull, PortConfigMode.Speed100MFull)
		const rejected = assert.rejects(command, /接続が変更または削除/)
		await writing.promise
		await instance.configUpdated({ ...config, host: '192.0.2.2' }, { password: 'test' })
		await instance.pollNow()
		pendingWrite.reject(new SwitchCommandError(103, 1001))
		await rejected
		assert.equal(writes.mock.callCount(), 1)
		assert.equal(instance.isConnected, true)
	})

	it('keeps a replacement login promise when an old login completes', async (context) => {
		const { instance, config, login, detail, writes, sessions } = createHarness(context)
		const oldLogin = Promise.withResolvers<void>()
		const newLogin = Promise.withResolvers<void>()
		const newLoginStarted = Promise.withResolvers<void>()
		login.mock.mockImplementation(async function (this: SwitchClient) {
			if (this.host === config.host) {
				await oldLogin.promise
			} else {
				newLoginStarted.resolve()
				await newLogin.promise
			}
			sessions.add(this)
		})
		await instance.init(config, false, { password: 'test' })
		const oldCommand = instance.setPoe(1, false)
		const rejected = assert.rejects(oldCommand, /接続が変更または削除/)
		await instance.configUpdated({ ...config, host: '192.0.2.2' }, { password: 'test' })
		await newLoginStarted.promise
		oldLogin.resolve()
		await rejected
		const newCommand = instance.setPoe(1, false)
		assert.equal(login.mock.callCount(), 2)
		assert.equal(detail.mock.callCount(), 0)
		newLogin.resolve()
		await newCommand
		assert.equal(login.mock.callCount(), 2)
		assert.deepEqual(
			writes.mock.calls.map((call) => call.arguments[0]),
			[50],
		)
	})
})
