import { Regex, type SomeCompanionConfigField } from '@companion-module/base'
import type { PortOrder } from './device-state.js'

export type ModuleConfig = {
	host: string
	pollInterval: number
	portOrder: PortOrder
	requestTimeout: number
}

export type ModuleSecrets = {
	password: string
}

export const DefaultConfig: ModuleConfig = {
	host: '',
	pollInterval: 5,
	portOrder: 'auto',
	requestTimeout: 5,
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'Connection notes',
			width: 12,
			value:
				'The switch supports only one session at a time. Connection fails while its web administration page is open in a browser. ' +
				'Traffic uses unencrypted HTTP; use this connection only on a trusted management LAN.',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Switch IP address',
			width: 6,
			regex: Regex.IP,
			default: DefaultConfig.host,
		},
		{
			type: 'secret-text',
			id: 'password',
			label: 'Administrator password',
			width: 6,
		},
		{
			type: 'number',
			id: 'pollInterval',
			label: 'State poll interval (seconds)',
			tooltip: 'The session idle timeout is about 3 minutes. Do not set this above 60 seconds.',
			width: 6,
			min: 1,
			max: 60,
			default: DefaultConfig.pollInterval,
		},
		{
			type: 'number',
			id: 'requestTimeout',
			label: 'Request timeout (seconds)',
			width: 6,
			min: 1,
			max: 30,
			default: DefaultConfig.requestTimeout,
		},
		{
			type: 'dropdown',
			id: 'portOrder',
			label: 'Port order',
			width: 12,
			default: DefaultConfig.portOrder,
			description:
				'Some models expose API ports in reverse physical order. Auto-detection uses the serial number. ' +
				'This 5-port PoE model reverses only the PoE ports; LAN1 remains last.',
			choices: [
				{ id: 'auto', label: 'Auto-detect (from serial number)' },
				{ id: 'normal', label: 'Normal (port 1 is first)' },
				{ id: 'reversed', label: 'Reversed (port 1 is last)' },
			],
		},
	]
}
