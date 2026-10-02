/**
 * Parsing and port-index maths for the `callcmd 101` (detail) payload.
 *
 * Kept free of Companion APIs so it can be unit tested against response
 * fixtures in device-state.test.ts.
 */

/**
 * `opcode = value << 9 | portIndex << 4 | op`, where op 0 = PHY mode, 2 = PoE, 3 = port reboot.
 * Decoded from the PS104GV3 web UI source and confirmed against the device.
 */
export const PortConfigMode = {
	PoeOn: 0x202,
	PoeOff: 0x002,
	Speed10MHalf: 0x200,
	Speed10MFull: 0x400,
	Speed100MFull: 0x800,
	Speed1GFull: 0xa00,
} as const

export type PortConfigModeValue = (typeof PortConfigMode)[keyof typeof PortConfigMode]

export function buildOpcode(mode: PortConfigModeValue, portIndex: number): number {
	return mode | (portIndex << 4)
}

/** `link[]` values from the detail payload. */
export const LinkLabels = ['Down', '10M half', '10M', '100M half', '100M', '1G'] as const
export const LinkSpeedMbps = [0, 10, 10, 100, 100, 1000] as const

export type PortOrder = 'auto' | 'normal' | 'reversed'

/**
 * Serial-number prefixes whose port 1 is the *last* array index.
 * From slydiman/sscpoe, which verified this against real hardware.
 * `PS1` is our own addition: sscpoe treats PS208G/PS308G as normal order, but the
 * PS104GV3 (2FE.POE+2GE.POE+1GE) sends opcode 0x232 for port 1 PoE on, i.e. index 3.
 */
const ReversedSerialPrefixes = ['GS1', 'GPS1', 'GPS2', 'GFS2', 'GPS4', 'PS1']

export function isReversedOrder(order: PortOrder, serial: string | undefined): boolean {
	if (order === 'normal') return false
	if (order === 'reversed') return true
	if (!serial) return false
	const sn = serial.toUpperCase()
	return ReversedSerialPrefixes.some((prefix) => sn.startsWith(prefix))
}

/**
 * Physical port number (1-based) to the 0-based index used by the API arrays.
 *
 * On reversed devices only the PoE ports are flipped among themselves; the uplink
 * ports keep the trailing indices. The PS104GV3 web UI encodes this as
 * `portIndex = [3, 2, 1, 0]` for the PoE ports plus `lan2list = [4]` for LAN1.
 */
export function portToIndex(port: number, poePortCount: number, portCount: number, reversed: boolean): number {
	if (!reversed || port > poePortCount || port > portCount) return port - 1
	return poePortCount - port
}

export interface PortStatus {
	/** Physical port number, 1-based. */
	port: number
	/** Index into the API's arrays. */
	index: number
	link: number
	linkLabel: string
	linkSpeedMbps: number
	rx: string
	tx: string
	phyc: number | undefined
	/** undefined for ports without PoE hardware (e.g. the uplink). */
	poe: boolean | undefined
	powerWatts: number | undefined
}

export interface DeviceState {
	serial: string | undefined
	mac: string | undefined
	firmware: string | undefined
	portCount: number
	poePortCount: number
	totalPowerWatts: number | undefined
	voltageVolts: number | undefined
	reversedOrder: boolean
	ports: PortStatus[]
}

function numberArray(value: unknown): number[] | undefined {
	if (!Array.isArray(value)) return undefined
	return value.map((v) => Number(v))
}

function stringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined
	return value.map((v) => String(v))
}

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
	if (value === undefined || value === null || value === '') return undefined
	const n = Number(value)
	return Number.isFinite(n) ? n : undefined
}

/**
 * `tp` is reported in milliwatts from firmware 6.0.250513 onwards.
 * Firmware strings look like `6.0.250111`, so the build component is comparable as a number.
 */
export function normalizeTotalPower(tp: number | undefined, firmware: string | undefined): number | undefined {
	if (tp === undefined) return undefined
	const build = Number(firmware?.split('.').at(-1))
	if (Number.isFinite(build)) return build >= 250513 ? tp / 1000 : tp
	// Unknown firmware: no realistic switch in this family draws over 1kW.
	return tp > 1000 ? tp / 1000 : tp
}

export function parseDetail(calldata: Record<string, unknown>, order: PortOrder): DeviceState {
	const link = numberArray(calldata.link) ?? []
	const phyc = numberArray(calldata.phyc) ?? []
	const poec = numberArray(calldata.poec) ?? []
	const pw = numberArray(calldata.pw) ?? []
	const rx = stringArray(calldata.rx) ?? []
	const tx = stringArray(calldata.tx) ?? []

	const serial = optionalString(calldata.sn)
	const firmware = optionalString(calldata.V)
	const portCount = Math.max(link.length, phyc.length, rx.length, tx.length, poec.length)
	const poePortCount = Math.max(poec.length, pw.length)
	const reversedOrder = isReversedOrder(order, serial)

	const ports: PortStatus[] = []
	for (let port = 1; port <= portCount; port++) {
		const index = portToIndex(port, poePortCount, portCount, reversedOrder)
		const linkValue = link[index] ?? 0
		// The PoE arrays cover only the first poePortCount indices, but use the same mapping.
		const poeIndex = index
		const hasPoe = port <= poePortCount && poeIndex < poePortCount

		ports.push({
			port,
			index,
			link: linkValue,
			linkLabel: LinkLabels[linkValue] ?? `Unknown (${linkValue})`,
			linkSpeedMbps: LinkSpeedMbps[linkValue] ?? 0,
			rx: rx[index] ?? '0',
			tx: tx[index] ?? '0',
			phyc: phyc[index],
			poe: hasPoe ? (poec[poeIndex] ?? 0) !== 0 : undefined,
			powerWatts: hasPoe ? pw[poeIndex] : undefined,
		})
	}

	return {
		serial,
		mac: optionalString(calldata.mac),
		firmware,
		portCount,
		poePortCount,
		totalPowerWatts: normalizeTotalPower(optionalNumber(calldata.tp), firmware),
		voltageVolts: optionalNumber(calldata.vol),
		reversedOrder,
		ports,
	}
}
