[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![Latest NPM release](https://img.shields.io/npm/v/homebridge-kobold.svg)](https://www.npmjs.com/package/homebridge-kobold)
[![NPM Downloads](https://img.shields.io/npm/dt/homebridge-kobold.svg)](https://www.npmjs.com/package/homebridge-kobold?activeTab=versions)


# homebridge-kobold

This is a plugin for [homebridge](https://github.com/nfarina/homebridge) to control your [Vorwerk Kobold](https://kobold.vorwerk.de/saugroboter/) VR300 vacuum robot. You can download it via [npm](https://www.npmjs.com/package/homebridge-kobold).

It is based on a fork of naofireblade's [homebridge-neato](https://github.com/naofireblade/homebridge-neato), merged with the oAuth authentication mechanism from nicoh88's [homebridge-vorwerk](https://github.com/nicoh88/homebridge-vorwerk).

The interaction with the Server is handled by the underlying [node-kobold-control](https://github.com/himbeles/node-kobold-control) module.

## Features

- House Cleaning
  - Eco mode
  - Extra care navigation
  - Nogo lines
- Zone cleaning <sup>[1](#change-room)</sup>
- Spot cleaning
  - Individual spot size <sup>[2](#eve)</sup>
  - Clean twice <sup>[2](#eve)</sup>
- Return to dock
- Find the robot
- Schedule (de)activation
- Robot information
  - Battery level
  - Charging state
  - Dock occupancy
  - Model and firmware version
- Automatic or periodic refresh of robot state
- Multiple robots
- Native Matter robotic vacuum accessory on Homebridge 2
  - Run and clean modes
  - Pause, resume, and return to dock
  - Operational, charging, and battery state
  - Room selection through Matter Service Areas
  - Identify/play-sound support

- German, English or French Language Setting

> <b name="change-room">2</b> You can send the robot from one room to another as well. He will return to the base, wait there some seconds and then starts cleaning the next room.

> <b name="eve">3</b> You need a third party app like eve to access these features.



## Installation

1. Install homebridge using: `npm install -g homebridge`
2. Install this plugin using: `npm install -g homebridge-kobold`
3. Update your configuration file. See the sample below.

## Development

The development workflow follows the [Homebridge plugin template](https://github.com/homebridge/homebridge-plugin-template). It uses the globally installed Homebridge and Config UI at runtime while keeping Homebridge as a local development dependency for TypeScript API definitions.

Install and activate Node.js 24 with nvm, then install or update the global tools and this repository's dependencies:

```bash
nvm install 24
nvm use
npm install -g homebridge@latest homebridge-config-ui-x@latest
npm ci
```

The plugin and its development workflow support Node.js 24 only. The repository's `.nvmrc` makes `nvm use` select the correct runtime.

Create a private local Homebridge configuration before the first run:

```bash
mkdir -p test/hbConfig
cp config.dev.example.json test/hbConfig/config.json
```

Replace `YOUR_KOBOLD_TOKEN` in `test/hbConfig/config.json`. The entire `test` directory is ignored because Homebridge writes credentials and pairing state there; never commit it.

Start the watch environment:

```bash
npm run watch
```

This builds the plugin, links it into the active global Node.js installation, watches `src` for TypeScript changes, and restarts the isolated Homebridge test server after each build. Its configuration and state live under `test/hbConfig`, and the local web interface is available at [http://localhost:8581](http://localhost:8581).

Stop any other Homebridge development instance first if it uses the same ports. Press `Ctrl+C` to stop the watcher and its Homebridge/UI child processes.

## Configuration

Add the following information to your config file. Adapt the value for `token`.

### Simple

```json
"platforms": [
  {
    "platform": "KoboldVacuumRobot",
    "token": "YourToken",
    "language": "de"
  }
]
```

You can get a token using the GUI tool [Kobold Token Getter](https://github.com/himbeles/kobold-token-get) or using the following two curl commands:

```bash
# This will trigger the email sending
curl -X "POST" "https://mykobold.eu.auth0.com/passwordless/start" \
     -H 'Content-Type: application/json' \
     -d '{
  "send": "code",
  "email": "ENTER_YOUR_EMAIL_HERE",
  "client_id": "KY4YbVAvtgB7lp8vIbWQ7zLk3hssZlhR",
  "connection": "email"
}'
```
==== wait for the email to be received ====

```bash
# this will generate a token using the numbers you received via email
# replace the value of otp 123456 with the value you received from the email
curl -X "POST" "https://mykobold.eu.auth0.com/oauth/token" \
     -H 'Content-Type: application/json' \
     -d '{
  "prompt": "login",
  "grant_type": "http://auth0.com/oauth/grant-type/passwordless/otp",
  "scope": "openid email profile read:current_user",
  "locale": "en",
  "otp": "123456",
  "source": "vorwerk_auth0",
  "platform": "ios",
  "audience": "https://mykobold.eu.auth0.com/userinfo",
  "username": "ENTER_YOUR_EMAIL_HERE",
  "client_id": "KY4YbVAvtgB7lp8vIbWQ7zLk3hssZlhR",
  "realm": "email",
  "country_code": "DE"
}'
```

From the output, you want to copy the `id_token` value.

The `language` can be `de` for German, `en` for English, or `fr` for French.

## Matter migration

Matter support follows Homebridge's [robotic-vacuum Matter API](https://github.com/homebridge-plugins/homebridge-matter/wiki/Section-12-Robotic). It requires Homebridge 2, Node.js 22 or 24, and Matter enabled for the main bridge or this plugin's child bridge. A child bridge is recommended while testing because it isolates the Matter server and pairing data.

Set `exposureMode` to choose which accessory implementation is published:

- `homekit` (default): Keep the existing HomeKit switches and sensors.
- `both`: Publish HomeKit and Matter accessories together while testing the migration.
- `matter`: Publish only the native Matter robotic vacuum. If Matter is not enabled, the plugin logs a warning and falls back to HomeKit so the robot remains available.

Example migration configuration:

```json
"platforms": [
  {
    "platform": "KoboldVacuumRobot",
    "token": "YourToken",
    "exposureMode": "both",
    "refresh": "auto"
  }
]
```

Restart Homebridge after enabling Matter. Each Kobold robotic vacuum receives its own Matter pairing QR code. Pair and validate the Matter accessory before changing `exposureMode` from `both` to `matter`. Homebridge Matter is not CSA-certified, so controllers may show an uncertified-accessory warning; pairing also requires Homebridge and the controller to share a network with working mDNS and IPv6.

The Matter accessory exposes normal and eco vacuum modes, start/pause/resume, return to dock, battery and charging state, Identify, and polygon map boundaries as selectable rooms. Schedule control, NoGo-line selection, Extra Care, and configurable spot-cleaning dimensions do not have faithful standard Matter RVC controls; they remain available only through the legacy HomeKit accessory when using `homekit` or `both`.

Using `both` can show duplicate robot controls when the HomeKit and Matter bridges are paired to the same Apple Home. It is intended as a temporary migration mode.

### Advanced

Below are explanations for advanced parameters to adjust the plugin to your needs. All parameters are *optional*.

**refresh**  
Timer for periodic refresh of robot state. The default is `auto`. The options are:  
`auto` Updates the robot state when a cleaning was started via homekit so that you can activate automations based on a successful cleaning.  
`120` Or any other time in seconds (minimum `60`) is required if you want to receive robot state updates after starting the cleaning from outside of homekit (e.g. neato app or schedule).  
`0` Disables background updates completely.

**hidden**  
List of plugin features that you don't want to use in HomeKit (e.g. `dock`, `dockstate`, `eco`, `nogolines`, `extracare`, `schedule`, `find`, `spot`). This setting does not remove Matter clusters.

```json
"platforms": [
  {
    "platform": "KoboldVacuumRobot",
    "token": "YourToken",
    "refresh": "120",
    "hidden": ["dock", "dockstate", "eco", "nogolines", "extracare", "schedule", "find", "spot"],
    "language": "de"
  }
]
```

## Tested robots

- Vorwerk Kobold VR300
