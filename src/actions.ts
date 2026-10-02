import type ModuleInstance from './main.js'
import { PortConfigMode } from './device-state.js'

export type ActionsSchema = {
	poe_set: {
		options: {
			port: number
			state: 'on' | 'off' | 'toggle'
		}
	}
	port_speed: {
		options: {
			port: number
			mode: 'auto1g' | 'extend10m' | 'speed100m' | 'speed10m'
		}
	}
	refresh: {
		options: Record<string, never>
	}
	reboot: {
		options: {
			confirm: boolean
		}
	}
}

export function PortChoices(portCount: number): { id: number; label: string }[] {
	return Array.from({ length: portCount }, (_, i) => ({ id: i + 1, label: `Port ${i + 1}` }))
}

export function UpdateActions(self: ModuleInstance): void {
	const portChoices = PortChoices(self.poePortCount)
	const allPortChoices = PortChoices(self.portCount)

	self.setActionDefinitions({
		poe_set: {
			name: 'Set PoE power',
			description:
				'Set PoE power ON, OFF, or toggle it for the selected port. Physical port mapping follows the configured port order.',
			options: [
				{
					id: 'port',
					type: 'dropdown',
					label: 'Port',
					default: portChoices[0]?.id ?? 1,
					choices: portChoices,
				},
				{
					id: 'state',
					type: 'dropdown',
					label: 'Action',
					default: 'toggle',
					choices: [
						{ id: 'on', label: 'Turn ON' },
						{ id: 'off', label: 'Turn OFF' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
			],
			callback: async (event) => {
				const port = Number(event.options.port)
				let turnOn: boolean
				if (event.options.state === 'toggle') {
					const current = self.getPort(port)?.poe
					if (current === undefined) {
						self.log('warn', `Cannot toggle PoE on port ${port}: current state is unknown`)
						return
					}
					turnOn = !current
				} else {
					turnOn = event.options.state === 'on'
				}
				await self.setPoe(port, turnOn)
			},
		},

		port_speed: {
			name: 'Set port speed / Extend mode',
			description:
				'Extend mode fixes the port at 10M full duplex to extend PoE range. If a 1G mode is rejected on a 100M-only port, the module falls back to 100M automatically.',
			options: [
				{
					id: 'port',
					type: 'dropdown',
					label: 'Port',
					default: allPortChoices[0]?.id ?? 1,
					choices: allPortChoices,
				},
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'auto1g',
					choices: [
						{ id: 'auto1g', label: 'Normal (1G full duplex)' },
						{ id: 'extend10m', label: 'Extend (10M full duplex)' },
						{ id: 'speed100m', label: '100M full duplex' },
						{ id: 'speed10m', label: '10M half duplex' },
					],
				},
			],
			callback: async (event) => {
				const port = Number(event.options.port)
				switch (event.options.mode) {
					case 'extend10m':
						await self.setPortMode(port, PortConfigMode.Speed10MFull, PortConfigMode.Speed10MHalf)
						break
					case 'speed100m':
						await self.setPortMode(port, PortConfigMode.Speed100MFull)
						break
					case 'speed10m':
						await self.setPortMode(port, PortConfigMode.Speed10MHalf)
						break
					default:
						await self.setPortMode(port, PortConfigMode.Speed1GFull, PortConfigMode.Speed100MFull)
						break
				}
			},
		},

		refresh: {
			name: 'Refresh state now',
			options: [],
			callback: async () => {
				await self.pollNow()
			},
		},

		reboot: {
			name: 'Reboot switch (DANGER)',
			description:
				'No confirmation dialog is shown. The switch reboots immediately, interrupting network traffic and PoE power for all connected devices for several seconds.',
			options: [
				{
					id: 'confirm',
					type: 'checkbox',
					label: 'I understand that this will reboot the switch',
					default: false,
				},
			],
			callback: async (event) => {
				if (!event.options.confirm) {
					self.log('warn', 'Reboot action skipped because the confirmation checkbox was not selected')
					return
				}
				await self.reboot()
			},
		},
	})
}
