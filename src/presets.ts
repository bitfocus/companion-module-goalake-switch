import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'

export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const toggleIds: string[] = []
	const onOffIds: string[] = []

	for (let port = 1; port <= self.poePortCount; port++) {
		const toggleId = `poe_toggle_${port}`
		toggleIds.push(toggleId)
		presets[toggleId] = {
			type: 'simple',
			name: `Port ${port} PoE toggle`,
			style: {
				text: `PoE ${port}\n$(${self.label}:port_${port}_poe)`,
				size: '14',
				color: 0xffffff,
				bgcolor: 0x333333,
				show_topbar: false,
			},
			steps: [
				{
					down: [{ actionId: 'poe_set', options: { port, state: 'toggle' } }],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'poe_state',
					options: { port, state: 'on' },
					style: { bgcolor: 0x00aa00, color: 0xffffff },
				},
			],
		}

		const onId = `poe_on_${port}`
		const offId = `poe_off_${port}`
		onOffIds.push(onId, offId)
		presets[onId] = {
			type: 'simple',
			name: `Port ${port} PoE ON`,
			style: { text: `PoE ${port}\nON`, size: '14', color: 0xffffff, bgcolor: 0x004400, show_topbar: false },
			steps: [{ down: [{ actionId: 'poe_set', options: { port, state: 'on' } }], up: [] }],
			feedbacks: [
				{ feedbackId: 'poe_state', options: { port, state: 'on' }, style: { bgcolor: 0x00aa00, color: 0xffffff } },
			],
		}
		presets[offId] = {
			type: 'simple',
			name: `Port ${port} PoE OFF`,
			style: { text: `PoE ${port}\nOFF`, size: '14', color: 0xffffff, bgcolor: 0x440000, show_topbar: false },
			steps: [{ down: [{ actionId: 'poe_set', options: { port, state: 'off' } }], up: [] }],
			feedbacks: [
				{ feedbackId: 'poe_state', options: { port, state: 'off' }, style: { bgcolor: 0xaa0000, color: 0xffffff } },
			],
		}
	}

	const linkIds: string[] = []
	for (let port = 1; port <= self.portCount; port++) {
		const id = `link_${port}`
		linkIds.push(id)
		presets[id] = {
			type: 'simple',
			name: `Port ${port} link state`,
			style: {
				text: `P${port}\n$(${self.label}:port_${port}_link)`,
				size: '14',
				color: 0xffffff,
				bgcolor: 0x000000,
				show_topbar: false,
			},
			steps: [],
			feedbacks: [
				{ feedbackId: 'link_state', options: { port, state: 'up' }, style: { bgcolor: 0x0066cc, color: 0xffffff } },
			],
		}
	}

	presets['device_status'] = {
		type: 'simple',
		name: 'Switch status',
		style: {
			text: `$(${self.label}:total_power)W\n$(${self.label}:firmware)`,
			size: '14',
			color: 0xffffff,
			bgcolor: 0x000000,
			show_topbar: false,
		},
		steps: [{ down: [{ actionId: 'refresh', options: {} }], up: [] }],
		feedbacks: [{ feedbackId: 'device_reachable', options: {}, style: { bgcolor: 0x000000, color: 0xffffff } }],
	}

	const structure: CompanionPresetSection<ModuleSchema>[] = [
		{
			id: 'poe',
			name: 'PoE control',
			definitions: [
				{ id: 'poe_toggle', name: 'PoE toggle', type: 'simple', presets: toggleIds },
				{ id: 'poe_onoff', name: 'PoE fixed ON / OFF', type: 'simple', presets: onOffIds },
			],
		},
		{
			id: 'status',
			name: 'Status display',
			definitions: [
				{ id: 'link', name: 'Link state', type: 'simple', presets: linkIds },
				{ id: 'device', name: 'Switch overview', type: 'simple', presets: ['device_status'] },
			],
		},
	]

	self.setPresetDefinitions(structure, presets)
}
