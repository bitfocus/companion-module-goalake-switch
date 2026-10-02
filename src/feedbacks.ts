import type ModuleInstance from './main.js'
import { PortChoices } from './actions.js'

export type FeedbacksSchema = {
	poe_state: {
		type: 'boolean'
		options: {
			port: number
			state: 'on' | 'off'
		}
	}
	link_state: {
		type: 'boolean'
		options: {
			port: number
			state: 'up' | 'down'
		}
	}
	device_reachable: {
		type: 'boolean'
		options: Record<string, never>
	}
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	const poePortChoices = PortChoices(self.poePortCount)
	const allPortChoices = PortChoices(self.portCount)

	self.setFeedbackDefinitions({
		poe_state: {
			name: 'PoE power state',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0x00aa00,
				color: 0xffffff,
			},
			options: [
				{
					id: 'port',
					type: 'dropdown',
					label: 'Port',
					default: poePortChoices[0]?.id ?? 1,
					choices: poePortChoices,
				},
				{
					id: 'state',
					type: 'dropdown',
					label: 'Expected state',
					default: 'on',
					choices: [
						{ id: 'on', label: 'Powered' },
						{ id: 'off', label: 'Not powered' },
					],
				},
			],
			callback: (feedback) => {
				const poe = self.getPort(Number(feedback.options.port))?.poe
				if (poe === undefined) return false
				return feedback.options.state === 'on' ? poe : !poe
			},
		},

		link_state: {
			name: 'Link state',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0x0066cc,
				color: 0xffffff,
			},
			options: [
				{
					id: 'port',
					type: 'dropdown',
					label: 'Port',
					default: allPortChoices[0]?.id ?? 1,
					choices: allPortChoices,
				},
				{
					id: 'state',
					type: 'dropdown',
					label: 'Expected state',
					default: 'up',
					choices: [
						{ id: 'up', label: 'Link up' },
						{ id: 'down', label: 'Link down' },
					],
				},
			],
			callback: (feedback) => {
				const port = self.getPort(Number(feedback.options.port))
				if (!port) return false
				const isUp = port.link > 0
				return feedback.options.state === 'up' ? isUp : !isUp
			},
		},

		device_reachable: {
			name: 'Switch reachable',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0xaa0000,
				color: 0xffffff,
			},
			options: [],
			callback: () => self.isConnected,
		},
	})
}
