import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
	buildOpcode,
	isReversedOrder,
	normalizeTotalPower,
	parseDetail,
	portToIndex,
	PortConfigMode,
} from './device-state.js'

/**
 * Representative `callcmd 101` response: 4 PoE ports + 1 uplink.
 */
const detailFixture = {
	sn: 'GPS204V3000123',
	mac: '00:11:22:33:44:55',
	V: '6.0.250111',
	poec: [1, 0, 1, 0],
	pw: [4.2, 0, 12.8, 0],
	phyc: [5, 5, 4, 4, 5],
	link: [5, 0, 4, 0, 5],
	rx: ['120', '0', '5400', '0', '9800'],
	tx: ['80', '0', '3200', '0', '15000'],
	tp: 17,
	vol: 53,
}

describe('buildOpcode', () => {
	it('encodes PoE on/off with the port index in bits 4-7', () => {
		assert.equal(buildOpcode(PortConfigMode.PoeOn, 0), 0x202)
		assert.equal(buildOpcode(PortConfigMode.PoeOff, 0), 0x002)
		assert.equal(buildOpcode(PortConfigMode.PoeOn, 3), 0x232)
		assert.equal(buildOpcode(PortConfigMode.PoeOff, 3), 0x032)
	})

	it('encodes speed modes', () => {
		assert.equal(buildOpcode(PortConfigMode.Speed1GFull, 2), 0xa20)
		assert.equal(buildOpcode(PortConfigMode.Speed10MFull, 1), 0x410)
	})

	// Captured from the PS104GV3 web UI: physical port 1 is index 3.
	it('matches the opcodes observed on real hardware', () => {
		assert.equal(buildOpcode(PortConfigMode.PoeOn, portToIndex(1, 4, 5, true)), 562)
		assert.equal(buildOpcode(PortConfigMode.PoeOff, portToIndex(1, 4, 5, true)), 50)
	})
})

describe('isReversedOrder', () => {
	it('honours an explicit override', () => {
		assert.equal(isReversedOrder('normal', 'GPS204V3'), false)
		assert.equal(isReversedOrder('reversed', 'PS208G'), true)
	})

	it('detects reversed families from the serial prefix', () => {
		assert.equal(isReversedOrder('auto', 'GPS204V3000123'), true)
		assert.equal(isReversedOrder('auto', 'GS105V1000123'), true)
		assert.equal(isReversedOrder('auto', 'PS104GV3255002416DIOYVVRL'), true)
		assert.equal(isReversedOrder('auto', 'PS308G000123'), false)
		assert.equal(isReversedOrder('auto', undefined), false)
	})
})

describe('portToIndex', () => {
	it('maps 1-based ports to array indices in both directions', () => {
		assert.equal(portToIndex(1, 4, 5, false), 0)
		assert.equal(portToIndex(4, 4, 5, false), 3)
		assert.equal(portToIndex(1, 4, 5, true), 3)
		assert.equal(portToIndex(4, 4, 5, true), 0)
	})

	it('leaves the uplink ports at their trailing indices', () => {
		assert.equal(portToIndex(5, 4, 5, true), 4)
		assert.equal(portToIndex(5, 4, 5, false), 4)
	})
})

describe('normalizeTotalPower', () => {
	it('leaves watts alone on older firmware', () => {
		assert.equal(normalizeTotalPower(17, '6.0.250111'), 17)
	})

	it('scales milliwatts on firmware 6.0.250513 and newer', () => {
		assert.equal(normalizeTotalPower(17000, '6.0.250513'), 17)
	})

	it('falls back to a magnitude check when the firmware is unknown', () => {
		assert.equal(normalizeTotalPower(17000, undefined), 17)
		assert.equal(normalizeTotalPower(17, undefined), 17)
	})
})

describe('parseDetail', () => {
	it('reads device metadata and port counts', () => {
		const state = parseDetail(detailFixture, 'normal')
		assert.equal(state.serial, 'GPS204V3000123')
		assert.equal(state.mac, '00:11:22:33:44:55')
		assert.equal(state.firmware, '6.0.250111')
		assert.equal(state.portCount, 5)
		assert.equal(state.poePortCount, 4)
		assert.equal(state.totalPowerWatts, 17)
		assert.equal(state.voltageVolts, 53)
	})

	it('maps ports straight through in normal order', () => {
		const state = parseDetail(detailFixture, 'normal')
		assert.deepEqual(
			state.ports.map((p) => p.poe),
			[true, false, true, false, undefined],
		)
		assert.deepEqual(
			state.ports.map((p) => p.linkLabel),
			['1G', 'Down', '100M', 'Down', '1G'],
		)
		assert.equal(state.ports[0].powerWatts, 4.2)
		assert.equal(state.ports[4].powerWatts, undefined)
	})

	it('reverses only the PoE ports when the serial says so', () => {
		const state = parseDetail(detailFixture, 'auto')
		assert.equal(state.reversedOrder, true)
		// Port 1 is the last PoE entry; the uplink keeps the trailing index.
		assert.equal(state.ports[0].index, 3)
		assert.equal(state.ports[0].linkLabel, 'Down')
		assert.equal(state.ports[0].poe, false)
		assert.equal(state.ports[3].index, 0)
		assert.equal(state.ports[3].poe, true)
		assert.equal(state.ports[4].index, 4)
		assert.equal(state.ports[4].poe, undefined)
		assert.equal(state.ports[4].linkLabel, '1G')
	})

	// Real `callcmd 101` payload from the PS104GV3 with only the uplink connected.
	it('matches the live PS104GV3 response', () => {
		const state = parseDetail(
			{
				sn: 'PS104GV3255002416DIOYVVRL',
				mac: '5C15C50AB300',
				V: '6.0.250516',
				vol: '52.2',
				tp: '0',
				pw: ['0', '0', '0', '0'],
				poec: [1, 1, 0, 0],
				phyc: [4, 4, 5, 5, 5],
				link: [0, 0, 0, 0, 5],
				tx: ['0', '0', '0', '0', '0'],
				rx: ['0', '0', '0', '0', '80'],
			},
			'auto',
		)
		// Ports 1/2 are the gigabit PoE ports, 3/4 the fast-ethernet ones, 5 is LAN1.
		assert.deepEqual(
			state.ports.map((p) => p.phyc),
			[5, 5, 4, 4, 5],
		)
		assert.deepEqual(
			state.ports.map((p) => p.poe),
			[false, false, true, true, undefined],
		)
		assert.equal(state.ports[4].linkLabel, '1G')
		assert.equal(state.ports[4].rx, '80')
	})

	it('tolerates a payload with no PoE hardware', () => {
		const state = parseDetail({ link: [5, 0], rx: ['1', '2'], tx: ['3', '4'] }, 'normal')
		assert.equal(state.poePortCount, 0)
		assert.deepEqual(
			state.ports.map((p) => p.poe),
			[undefined, undefined],
		)
	})
})
