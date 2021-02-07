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

- German or English Language Setting 

> <b name="change-room">2</b> You can send the robot from one room to another as well. He will return to the base, wait there some seconds and then starts cleaning the next room.

> <b name="eve">3</b> You need a third party app like eve to access these features.



## Installation

1. Install homebridge using: `npm install -g homebridge`
2. Install this plugin using: `npm install -g homebridge-kobold`
3. Update your configuration file. See the sample below.

## Configuration

Add the following information to your config file. Change the values for email and password.

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

You can get a token using the following two curl commands:

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

The `language` can be `de` for German, or `en` for English.

### Advanced

Below are explanations for advanced parameters to adjust the plugin to your needs. All parameters are *optional*.

**refresh**  
Timer for periodic refresh of robot state. The default is `auto`. The options are:  
`auto` Updates the robot state when a cleaning was started via homekit so that you can activate automations based on a successful cleaning.  
`120` Or any other time in seconds (minimum `60`) is required if you want to receive robot state updates after starting the cleaning from outside of homekit (e.g. neato app or schedule).  
`0` Disables background updates completely.

**hidden**  
List of plugin features that you don't want to use in homekit (e.g. `dock`, `dockstate`, `eco`, `nogolines`, `extracare`, `schedule`, `find`, `spot`).

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
