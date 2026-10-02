# companion-module-goalake-switch

Bitfocus Companion connection for Goalake PoE switches and their OEM siblings
(Realtek reference "Easy Smart Managed" firmware).

End-user documentation lives in [companion/HELP.md](companion/HELP.md).
Source and issue tracking are hosted at
[bitfocus/companion-module-goalake-switch](https://github.com/bitfocus/companion-module-goalake-switch).
The protocol notes below summarize the confirmed PS104GV3 behavior needed for development.

## Development

Use Node.js 22.20 or newer within the 22.x release line and Yarn 4 via Corepack.

```sh
corepack enable
yarn install
yarn build      # transpile src/ -> dist/
yarn dev        # watch mode
yarn lint       # eslint + prettier
yarn test       # unit tests (node:test)
```

Point Companion's _Developer modules path_ at the parent directory of this folder,
then add a "Goalake PoE Switch" connection. Companion restarts the connection on
every file save, so `yarn dev` gives a live reload loop.

GitHub Actions runs build, lint, and unit tests on pushes and pull requests.
The official Companion Module Checks workflow also packages the module and checks
that it loads. Its `pkg` artifact can be downloaded for manual distribution.

## Source layout

| File                                                                          | Responsibility                                                              |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/main.ts`                                                                 | `InstanceBase` subclass: lifecycle, session handling, polling loop          |
| `src/switch-client.ts`                                                        | HTTP transport for the device's `callcmd` protocol                          |
| `src/device-state.ts`                                                         | Pure parsing of the `callcmd 101` payload + opcode/port-index maths         |
| `src/config.ts`                                                               | Connection config fields (host, secret password, poll interval, port order) |
| `src/actions.ts` / `src/feedbacks.ts` / `src/variables.ts` / `src/presets.ts` | Companion surface                                                           |

`src/device-state.ts` deliberately has no Companion imports so it can be unit tested
in isolation; `src/device-state.test.ts` covers the opcode encoding, the reversed
port-order detection, the firmware-dependent power scaling and the detail parser.

## Protocol notes that shape the code

- One session per device, device-wide. A second login is answered by a TCP reset,
  indistinguishable from a network fault. `configUpdated`/`destroy` therefore log out
  before doing anything else.
- Bad auth, unknown paths and back-to-back requests are all answered by dropping the
  connection rather than an HTTP error, so `SwitchClient` serialises every request
  through one queue with a minimum gap and retries once before reporting failure.
- Idle-session testing succeeded at 180 seconds and failed at 240 seconds; the poll interval is capped at 60s.
- `opcode = (value << 9) | (portIndex << 4) | op` for `callcmd 103`, where op 0 = PHY mode,
  2 = PoE, and 3 = port reboot. `0x202` = PoE on, `0x002` = PoE off at array index 0.
  Speed modes fall back to a slower value when the device answers `errcode 1001`.
- The confirmed PS104GV3 mapping is array indexes 0-4 = physical ports 4, 3, 2, 1, and LAN1.
  Only the PoE ports are reversed; the uplink remains last. Auto-detection uses serial prefixes
  adapted from [slydiman/sscpoe](https://github.com/slydiman/sscpoe), with `PS1` added for this model.
  A manual override is available for other models.

## Deliberately not implemented

`factory_reset` (105), `firmware_upgrade` (102), config restore (201 with calldata) and
`sn_reset` (132) are reachable over the same API but are not exposed as actions.
Companion has no confirmation dialog, and an accidental button press would be
unrecoverable. `reboot` (104) is exposed but gated behind an explicit opt-in checkbox.
