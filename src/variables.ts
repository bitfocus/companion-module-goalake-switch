import type { CompanionVariableDefinitions } from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { DeviceState } from './device-state.js'

export type VariablesSchema = Record<string, string | number | undefined>

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const definitions: CompanionVariableDefinitions<VariablesSchema> = {
		serial: { name: 'Serial number' },
		mac: { name: 'MAC address' },
		firmware: { name: 'Firmware version' },
		port_count: { name: 'Port count' },
		poe_port_count: { name: 'PoE port count' },
		total_power: { name: 'Total PoE power (W)' },
		voltage: { name: 'PoE voltage (V)' },
		port_order: { name: 'Port order (normal / reversed)' },
	}

	for (let port = 1; port <= self.portCount; port++) {
		definitions[`port_${port}_link`] = { name: `Port ${port} link state` }
		definitions[`port_${port}_link_speed`] = { name: `Port ${port} link speed (Mbps)` }
		definitions[`port_${port}_rx`] = { name: `Port ${port} receive rate` }
		definitions[`port_${port}_tx`] = { name: `Port ${port} transmit rate` }
	}

	for (let port = 1; port <= self.poePortCount; port++) {
		definitions[`port_${port}_poe`] = { name: `Port ${port} PoE power state` }
		definitions[`port_${port}_power`] = { name: `Port ${port} PoE power (W)` }
	}

	self.setVariableDefinitions(definitions)
}

export function BuildVariableValues(state: DeviceState): VariablesSchema {
	const values: VariablesSchema = {
		serial: state.serial ?? '',
		mac: state.mac ?? '',
		firmware: state.firmware ?? '',
		port_count: state.portCount,
		poe_port_count: state.poePortCount,
		total_power: state.totalPowerWatts ?? 0,
		voltage: state.voltageVolts ?? 0,
		port_order: state.reversedOrder ? 'reversed' : 'normal',
	}

	for (const port of state.ports) {
		values[`port_${port.port}_link`] = port.linkLabel
		values[`port_${port.port}_link_speed`] = port.linkSpeedMbps
		values[`port_${port.port}_rx`] = port.rx
		values[`port_${port.port}_tx`] = port.tx
		if (port.poe !== undefined) {
			values[`port_${port.port}_poe`] = port.poe ? 'ON' : 'OFF'
			values[`port_${port.port}_power`] = port.powerWatts ?? 0
		}
	}

	return values
}

/** Blank out the per-device values so buttons don't keep showing stale data after a disconnect. */
export function BuildEmptyVariableValues(portCount: number, poePortCount: number): VariablesSchema {
	const values: VariablesSchema = {
		total_power: 0,
		voltage: 0,
	}
	for (let port = 1; port <= portCount; port++) {
		values[`port_${port}_link`] = '?'
		values[`port_${port}_link_speed`] = 0
		values[`port_${port}_rx`] = '?'
		values[`port_${port}_tx`] = '?'
	}
	for (let port = 1; port <= poePortCount; port++) {
		values[`port_${port}_poe`] = '?'
		values[`port_${port}_power`] = 0
	}
	return values
}
