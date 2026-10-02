# Goalake PoE Switch

Control Goalake PoE switches and compatible OEM models through the same HTTP API used by their web administration interface.

## Supported models

- Goalake 5-Port PoE Switch (Amazon ASIN: `B099PKV69M`)
- Easy Smart Managed switches using the same Realtek reference firmware, including possible OEM models from Hasivo, MokerLink, Horaco, and Sodola

The device must provide a web administration interface at `http://<switch-ip>/`. Older firmware without a web UI, such as `6.0.231024`, is not supported.

## Configuration

| Field | Description |
|---|---|
| Switch IP address | The same IP address used by the web administration interface |
| Administrator password | Web administration password, stored as a Companion secret and never exposed in logs or variables |
| State poll interval | Default 5 seconds. Keep it at or below 60 seconds because the switch session expires after about 3 minutes |
| Request timeout | Maximum wait for one HTTP request, default 5 seconds |
| Port order | See Port order below |

## Important limitations

### Only one session is supported

The switch supports **one login session for the entire device**. This connection cannot connect while the web administration interface is open in a browser, and the browser cannot log in while this connection is active.

After closing the browser, the switch may take **up to about 2 minutes** to release the session.

### Traffic is not encrypted

The switch does not support HTTPS. All traffic, including the administrator password, uses plain HTTP. Do not expose the switch to the internet or an untrusted shared network.

### Port order

Some models expose API ports in the reverse of their physical numbering. Testing confirmed that this model (`PS104GV3` / `2FE.POE+2GE.POE+1GE`, firmware `6.0.250516`) reverses **only the PoE ports**; the uplink remains last. Auto-detection treats serial numbers beginning with `PS1` as reversed.

| Array index | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| Physical port | Port 4 | Port 3 | Port 2 | Port 1 | `LAN1` (uplink) |

Companion ports 1-4 are PoE ports, and port 5 is `LAN1` (uplink). Select Normal or Reversed manually if another model does not match this layout.

The `$(this connection:port_order)` variable reports the active order (`normal` or `reversed`).

## Actions

| Action | Description |
|---|---|
| Set PoE power | Turn PoE ON, OFF, or toggle it for a selected port |
| Set port speed / Extend mode | Select 1G, 100M, 10M, or Extend (10M full duplex). A rejected 1G request automatically falls back to 100M |
| Refresh state now | Retrieve state immediately instead of waiting for the next poll |
| Reboot switch (DANGER) | See the warning below |

### Reboot warning

Companion does not show a confirmation dialog. Pressing the action reboots the entire switch immediately, interrupting network traffic and PoE power for all connected devices for several seconds.

The action requires its confirmation checkbox, `I understand that this will reboot the switch`, to be selected. Adding a warning to the button label is also recommended.

Factory reset, firmware upgrade, configuration restore, and serial-number reset are intentionally not exposed by this module.

## Feedbacks

| Feedback | Description |
|---|---|
| PoE power state | Changes the button color when the selected port is powered or not powered |
| Link state | Changes the button color when the selected port is linked or unlinked |
| Switch reachable | Reports whether this connection can communicate with the switch |

## Variables

Switch-wide variables:

- `$(this connection:serial)` - Serial number
- `$(this connection:mac)` - MAC address
- `$(this connection:firmware)` - Firmware version
- `$(this connection:port_count)` / `$(this connection:poe_port_count)` - Total ports / PoE ports
- `$(this connection:total_power)` - Total PoE power (W)
- `$(this connection:voltage)` - PoE voltage (V)
- `$(this connection:port_order)` - Active port order (`normal` / `reversed`)

Per-port variables, where `N` is the Companion port number:

- `$(this connection:port_N_link)` - Link state (`Down`, `10M`, `100M`, `1G`, and so on)
- `$(this connection:port_N_link_speed)` - Link speed (Mbps)
- `$(this connection:port_N_rx)` / `$(this connection:port_N_tx)` - Receive / transmit rate
- `$(this connection:port_N_poe)` - PoE power state (`ON` / `OFF`, PoE ports only)
- `$(this connection:port_N_power)` - PoE power (W, PoE ports only)

Per-port variables become `?` while the connection is offline.

## Presets

- **PoE control** - Per-port PoE toggle, fixed ON, and fixed OFF buttons
- **Status display** - Per-port link status and switch-wide power display; pressing the switch status preset refreshes state

Preset buttons are regenerated after the connection discovers the switch port count.

## Troubleshooting

| Symptom | Check |
|---|---|
| Status remains `Connection failure` | Close the web administration interface and wait about 2 minutes. Check the IP address and password |
| Turning off PoE affects another port | Switch Port order between Normal and Reversed |
| Port speed does not change | The port may not support the requested speed; this model includes 100M-only ports |
| State updates are slow | Reduce the poll interval, but do not use less than 1-2 seconds because the switch HTTP server has limited capacity |
